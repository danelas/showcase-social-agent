/**
 * The makeover render. Takes the downloaded clip + optional captions and
 * produces a polished 1080x1920 vertical MP4 plus a cover image:
 *   - blurred-fill framing to 9:16 (keeps ALL of their content — no crop)
 *   - burned-in captions (from the .ass file, if any)
 *   - an opening hook overlay on the first ~1.7s
 *   - a bottom brand bar: business name · service · PeekScout
 *   - a cover image (a mid-clip frame with the hook)
 *
 * ffmpeg drawtext uses textfile= for user strings so we never fight escaping.
 */
import { join } from "path";
import { writeFile } from "fs/promises";
import { run, findFont, escFilterPath } from "./proc";

const W = 1080;
const H = 1920;
const FPS = 30;
// libx264 on Linux CI; this dev box OOMs libx264 → set RENDER_VCODEC=h264_mf.
const VCODEC = process.env.RENDER_VCODEC || "libx264";
const BAR_H = 200; // bottom brand bar height
export const CAPTION_MARGIN_V = BAR_H + 40; // captions sit above the bar

function nameFontSize(name: string): number {
  const n = name.length;
  if (n <= 14) return 60;
  if (n <= 22) return 50;
  if (n <= 30) return 42;
  return 34;
}

// Size the opening hook so it fits the frame width on one line. drawtext can't
// wrap, so a fixed size overflows/clips longer hooks (e.g. a 6-word line at 90px
// runs off both edges). Scale the font to the safe width instead.
//   safeW ≈ W - 80px (40px margins each side); bold-uppercase advance ≈ 0.62em.
function fitFontSize(text: string, safeW: number, max: number, min: number): number {
  const chars = Math.max(text.trim().length, 1);
  const fs = Math.floor(safeW / (chars * 0.62));
  return Math.max(min, Math.min(max, fs));
}

export type RenderResult = { videoPath: string; coverPath: string };

export async function renderMakeover(
  dir: string,
  input: { videoPath: string; assPath: string | null; hook: string; name: string; service: string },
): Promise<RenderResult> {
  const font = await findFont();
  if (!font) throw new Error("no TTF font available for drawtext");
  const ef = escFilterPath(font);

  // User strings via textfile to dodge drawtext escaping.
  const nameFile = join(dir, "m_name.txt");
  const svcFile = join(dir, "m_svc.txt");
  const hookFile = join(dir, "m_hook.txt");
  await writeFile(nameFile, input.name);
  await writeFile(svcFile, input.service);
  await writeFile(hookFile, input.hook.toUpperCase());
  const en = escFilterPath(nameFile);
  const es = escFilterPath(svcFile);
  const eh = escFilterPath(hookFile);
  const nameSize = nameFontSize(input.name);
  // Auto-size the hook (overlay + cover) so long hooks don't clip off-frame.
  const hookSize = fitFontSize(input.hook, W - 80, 90, 40);
  const coverHookSize = fitFontSize(input.hook, W - 80, 104, 44);

  // 1) blurred-fill 9:16 base (no content lost)
  let graph =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=20,eq=brightness=-0.05[bg];` +
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2[base];`;

  // 2) captions (optional)
  let prev = "base";
  if (input.assPath) {
    graph += `[base]ass='${escFilterPath(input.assPath)}'[cap];`;
    prev = "cap";
  }

  // 3) brand bar + 4) hook overlay (first ~1.7s). Commas inside expressions are
  // escaped \, so they aren't read as filter separators.
  const overlays =
    `drawbox=x=0:y=${H - BAR_H}:w=${W}:h=${BAR_H}:color=black@0.42:t=fill,` +
    `drawtext=fontfile='${ef}':textfile='${en}':fontcolor=white:fontsize=${nameSize}:` +
    `x=56:y=${H - 168}:shadowcolor=black@0.7:shadowx=2:shadowy=2,` +
    `drawtext=fontfile='${ef}':textfile='${es}':fontcolor=white@0.85:fontsize=40:` +
    `x=56:y=${H - 96}:shadowcolor=black@0.7:shadowx=2:shadowy=2,` +
    `drawtext=fontfile='${ef}':text='PeekScout':fontcolor=white@0.6:fontsize=34:` +
    `x=w-tw-56:y=${H - 88},` +
    `drawtext=fontfile='${ef}':textfile='${eh}':fontcolor=white:fontsize=${hookSize}:` +
    `box=1:boxcolor=black@0.5:boxborderw=26:x=(w-tw)/2:y=${Math.round(H * 0.15)}:` +
    `enable='lt(t,1.7)'`;

  graph += `[${prev}]${overlays}[out]`;

  const videoPath = join(dir, "makeover.mp4");
  await run(
    "ffmpeg",
    [
      "-y",
      "-i", input.videoPath,
      "-filter_complex", graph,
      "-map", "[out]",
      "-map", "0:a?", // keep audio if present
      "-r", String(FPS),
      "-c:v", VCODEC,
      "-pix_fmt", "yuv420p",
      "-b:v", "6M",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      videoPath,
    ],
    300_000,
  );

  // Cover: a mid-clip frame from the finished video + the hook, centered.
  const coverPath = join(dir, "cover.jpg");
  await run(
    "ffmpeg",
    [
      "-y",
      "-ss", "2.5",
      "-i", videoPath,
      "-vframes", "1",
      "-vf",
      `drawtext=fontfile='${ef}':textfile='${eh}':fontcolor=white:fontsize=${coverHookSize}:` +
        `box=1:boxcolor=black@0.5:boxborderw=30:x=(w-tw)/2:y=(h-th)/2`,
      "-q:v", "3",
      coverPath,
    ],
    60_000,
  ).catch(async () => {
    // Clip shorter than 2.5s → grab the first frame instead.
    await run("ffmpeg", ["-y", "-i", videoPath, "-vframes", "1", "-q:v", "3", coverPath], 60_000);
  });

  return { videoPath, coverPath };
}
