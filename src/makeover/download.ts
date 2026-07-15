/**
 * Download a provider's public Instagram/TikTok video with yt-dlp.
 *
 * yt-dlp handles both platforms and, for TikTok, fetches the no-watermark
 * source. CI installs yt-dlp (see .github/workflows/makeover.yml). Fail-open:
 * any problem returns null and the caller marks the request FAILED.
 */
import { join } from "path";
import { readdir } from "fs/promises";
import { run } from "./proc";

const YTDLP = process.env.YTDLP_BIN || "yt-dlp";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36";

// Optional cookies file (some IG content needs a logged-in session). Set
// YTDLP_COOKIES to a path on CI if public downloads start failing.
const COOKIES = process.env.YTDLP_COOKIES || "";

export async function downloadVideo(url: string, dir: string): Promise<string | null> {
  const outTmpl = join(dir, "src.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "--max-filesize", "150M",
    "--user-agent", UA,
    // Prefer a single progressive mp4 up to 1080p so we don't need to mux.
    "-f", "mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
    "--merge-output-format", "mp4",
    "-o", outTmpl,
  ];
  if (COOKIES) args.push("--cookies", COOKIES);
  args.push(url);

  try {
    await run(YTDLP, args, 120_000);
  } catch (e) {
    console.log(`     yt-dlp failed: ${(e as Error).message}`);
    return null;
  }

  // Find the produced file (extension depends on the source/merge).
  try {
    const files = await readdir(dir);
    const src = files.find((f) => f.startsWith("src."));
    return src ? join(dir, src) : null;
  } catch {
    return null;
  }
}
