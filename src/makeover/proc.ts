/**
 * Small child-process helpers shared across the makeover pipeline. Mirrors the
 * spawn/ffprobe patterns already used in recruit/render-video.ts.
 */
import { spawn } from "child_process";
import { access } from "fs/promises";

export function run(
  cmd: string,
  args: string[],
  timeoutMs = 180_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    const t = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} timeout`));
    }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`));
    });
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

// Run and capture stdout (for ffprobe / yt-dlp --get-*).
export function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    const t = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error(`${cmd} timeout`));
    }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exit ${code}: ${err.slice(-400)}`));
    });
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

// ffprobe → [width, height] of the first video stream, or null.
export async function probeDims(path: string): Promise<[number, number] | null> {
  try {
    const out = await runCapture("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x", path,
    ]);
    const m = out.trim().match(/^(\d+)x(\d+)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
  } catch {
    return null;
  }
}

// ffprobe → duration in seconds, or null.
export async function probeDuration(path: string): Promise<number | null> {
  try {
    const out = await runCapture("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "csv=p=0", path,
    ]);
    const n = Number(out.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// A bold TTF for burned text. First existing wins (CI = DejaVu; Win/Mac local).
const FONT_CANDIDATES = [
  process.env.RENDER_FONT || "",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/segoeuib.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
].filter(Boolean);

export async function findFont(): Promise<string | null> {
  for (const f of FONT_CANDIDATES) {
    try {
      await access(f);
      return f;
    } catch {
      /* next */
    }
  }
  return null;
}

// Escape a path for use inside an ffmpeg filter arg (drawtext fontfile, etc.).
export const escFilterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

// Escape literal text for ffmpeg drawtext `text=` values.
export const escDrawtext = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "’").replace(/%/g, "\\%");
