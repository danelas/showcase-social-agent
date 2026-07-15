/**
 * PeekScout Video Makeover worker. Claims PENDING makeover_requests and, for
 * each one:
 *   download (yt-dlp) → transcribe (Groq Whisper) → captions (.ass) →
 *   opening hook (Claude) → render (ffmpeg) → upload → email → mark DONE.
 *
 *   npx tsx src/makeover/run.ts                 # dry-run: list what's queued
 *   npx tsx src/makeover/run.ts --live --max 10 # actually process + email
 *
 * Fail-open per request: any stage error marks that row FAILED and moves on;
 * one bad video never blocks the batch. Runs on CI where ffmpeg + yt-dlp are
 * installed (see .github/workflows/makeover.yml).
 */
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "../recruit/db";
import { uploadMedia } from "../recruit/upload";
import { claimPending, markDone, markFailed, summary } from "./db";
import { downloadVideo } from "./download";
import { transcribe } from "./transcribe";
import { writeCaptions } from "./captions";
import { writeHook } from "./hook";
import { renderMakeover, CAPTION_MARGIN_V } from "./render";
import { probeDims } from "./proc";
import { sendMakeoverEmail } from "./email";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function processOne(row: Awaited<ReturnType<typeof claimPending>>[number]): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "makeover-"));
  try {
    // 1. Download their clip.
    const src = await downloadVideo(row.sourceUrl, dir);
    if (!src) throw new Error("download failed (private, removed, or unsupported URL)");

    // 2. Transcribe → 3. captions (both optional; render works without them).
    const transcript = await transcribe(src, dir).catch(() => null);
    const dims = await probeDims(src);
    const assPath = transcript
      ? await writeCaptions(transcript.words, dir, {
          w: dims?.[0] ?? 1080,
          h: dims?.[1] ?? 1920,
          marginV: CAPTION_MARGIN_V,
        }).catch(() => null)
      : null;

    // 4. Opening hook.
    const hook = await writeHook({
      name: row.name,
      service: row.service,
      transcript: transcript?.text ?? "",
    });

    // 5. Render.
    const { videoPath, coverPath } = await renderMakeover(dir, {
      videoPath: src,
      assPath,
      hook,
      name: row.name,
      service: row.service,
    });

    // 6. Upload.
    const resultUrl = await uploadMedia(videoPath, "video", "mp4", "video/mp4");
    if (!resultUrl) throw new Error("upload failed");
    const coverUrl = await uploadMedia(coverPath, "image", "jpg", "image/jpeg");

    // 7. Email + mark DONE.
    let resendId: string | null = null;
    try {
      const { id } = await sendMakeoverEmail({ to: row.email, name: row.name, resultUrl, coverUrl });
      resendId = id ?? null;
    } catch (e) {
      // Render succeeded but delivery failed — keep the result, log, still DONE
      // (operator can resend). Better than discarding a good render.
      console.log(`     ⚠ email failed: ${(e as Error).message}`);
    }
    await markDone(row.id, { resultUrl, coverUrl, hook, resendId });
    console.log(`     ✓ done · hook "${hook}" · ${resultUrl}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  const live = flag("live");
  const max = Number(arg("max") ?? "10");

  if (!live) {
    const pending = await prisma.makeoverRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: max,
      select: { name: true, service: true, sourceUrl: true, email: true },
    });
    console.log(`[makeover] DRY-RUN — ${pending.length} queued (cap ${max}):`);
    pending.forEach((p, i) => console.log(`  [${i + 1}] ${p.name} (${p.service}) — ${p.sourceUrl}`));
    console.log(`\nStatus tally:`, await summary());
    console.log(`\nRun with --live to process + email.`);
    return;
  }

  const batch = await claimPending(max);
  console.log(`[makeover] LIVE — processing ${batch.length} request(s) (cap ${max})\n`);
  if (!batch.length) {
    console.log("Nothing queued.");
    return;
  }

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    console.log(`[${i + 1}/${batch.length}] ${row.name} — ${row.sourceUrl}`);
    try {
      await processOne(row);
      ok++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message;
      console.log(`     ✗ ${msg}`);
      await markFailed(row.id, msg).catch(() => {});
    }
  }
  console.log(`\n[makeover] complete: ${ok} done, ${failed} failed`);
  console.log(`Status tally:`, await summary());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
