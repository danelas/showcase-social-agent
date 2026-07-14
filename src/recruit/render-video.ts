/**
 * Render a nice vertical slideshow MP4 from a provider's best website photos,
 * so a recruited profile has a real video trailer (not just a photo reel).
 *
 * Runs on the Linux CI runner where ffmpeg is pre-installed. Each image is
 * framed 1080x1920 with a blurred fill (so wide banners don't get ugly bars),
 * given a slow Ken Burns zoom, and crossfaded into the next. No text overlay —
 * the feed card already shows the name, and burning fonts is fragile.
 *
 * Fail-open: any problem returns null and the caller falls back to the
 * gallery-only slideshow (PhotoReel).
 */
import { spawn } from "child_process";
import { mkdtemp, writeFile, rm, readFile, access } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { categoryBackground } from "./category-backgrounds";

// A bold TTF for the title card. First existing wins (CI = DejaVu, Win/Mac for
// local testing). ffmpeg drawtext needs a real font file path.
const FONT_CANDIDATES = [
  process.env.RENDER_FONT || "",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/segoeuib.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
].filter(Boolean);

async function findFont(): Promise<string | null> {
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

// ffmpeg drawtext fontfile path needs : and \ escaped on the filter arg.
const escFont = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

const CLIP_SECS = 3; // per image
const XFADE = 0.6; // crossfade duration
const W = 1080;
const H = 1920;
const FPS = 30;
// libx264 on Linux CI; overridable (this dev box OOMs libx264 — use h264_mf).
const VCODEC = process.env.RENDER_VCODEC || "libx264";

function run(cmd: string, args: string[], timeoutMs = 120_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    const t = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${err.slice(-400)}`));
    });
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

async function download(url: string, dest: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PeekScoutBot/1.0)" },
    }).finally(() => clearTimeout(t));
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 3000) return false; // too small to be a real photo
    await writeFile(dest, buf);
    return true;
  } catch {
    return false;
  }
}

// ffprobe an image → [width, height], or null.
function probeDims(path: string): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x", path,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", () => {
      const m = out.trim().match(/^(\d+)x(\d+)/);
      resolve(m ? [Number(m[1]), Number(m[2])] : null);
    });
    p.on("error", () => resolve(null));
  });
}

// Download candidates, keep only images that FRAME WELL vertically — portrait,
// square, or mildly-landscape (aspect ≤ 1.5) and reasonably sized. Wide banners
// (which crop to an empty center or letterbox with bars) are dropped. Returns
// the kept URLs + their downloaded file paths, sharing one download for both
// the gallery and the video render.
export async function selectFramablePhotos(
  urls: string[],
  dir: string,
  max = 5,
): Promise<{ url: string; file: string }[]> {
  const kept: { url: string; file: string }[] = [];
  for (const url of urls) {
    if (kept.length >= max) break;
    const file = join(dir, `cand${kept.length}`);
    if (!(await download(url, file))) continue;
    const dims = await probeDims(file);
    if (!dims) continue;
    const [w, h] = dims;
    if (w < 400 || h < 400) continue; // too small / thumbnail
    if (w / h > 1.5) continue; // too wide to frame vertically
    kept.push({ url, file });
  }
  return kept;
}

// Per-image: cover-crop to fill the vertical frame (no letterbox bars), with a
// slow Ken Burns zoom. Portrait/square photos look great; wide banners show a
// centered slice — imperfect but full-frame, and the owner can swap on claim.
function clipFilter(idx: number): string {
  const frames = CLIP_SECS * FPS;
  const zoom = idx % 2 === 0 ? "min(zoom+0.0012,1.15)" : "1.15-0.0012*on";
  return (
    `[${idx}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,` +
    `zoompan=z='${zoom}':d=${frames}:s=${W}x${H}:fps=${FPS}[v${idx}]`
  );
}

const TITLE_SECS = 2.8;

function nameFontSize(name: string): number {
  const n = name.length;
  if (n <= 14) return 84;
  if (n <= 20) return 64;
  if (n <= 28) return 50;
  return 40;
}

// Clean branded intro: a category-relevant photo backdrop (darkened for
// legibility, slow Ken Burns) with the business name + category·city on top.
// Falls back to an animated violet gradient when no backdrop is available.
// Always renders (no dependency on the provider's own photos).
async function renderTitleCard(
  dir: string,
  font: string,
  info: { name: string; category: string; city: string },
  bgFile: string | null,
): Promise<string> {
  const nameFile = join(dir, "name.txt");
  const subFile = join(dir, "sub.txt");
  await writeFile(nameFile, info.name);
  await writeFile(subFile, `${info.category}  ·  ${info.city}`);

  const ef = escFont(font);
  const en = escFont(nameFile);
  const es = escFont(subFile);
  const nameSize = nameFontSize(info.name);

  // Text overlays (shared by both backdrop paths). A dark scrim goes first so
  // white text stays legible over any photo.
  const textFilters =
    `drawbox=x=0:y=0:w=${W}:h=${H}:color=black@0.5:t=fill,` +
    `drawtext=fontfile='${ef}':textfile='${en}':fontcolor=white:fontsize=${nameSize}:` +
    `x=(w-tw)/2:y=h*0.40:shadowcolor=black@0.7:shadowx=2:shadowy=3,` +
    `drawtext=fontfile='${ef}':textfile='${es}':fontcolor=white@0.92:fontsize=38:` +
    `x=(w-tw)/2:y=h*0.40+${Math.round(nameSize * 1.35)}:shadowcolor=black@0.7:shadowx=2:shadowy=2,` +
    `drawtext=fontfile='${ef}':text='Watch • Book • PeekScout':fontcolor=white@0.75:fontsize=30:` +
    `x=(w-tw)/2:y=h*0.88:shadowcolor=black@0.7:shadowx=2:shadowy=2,` +
    `fade=t=in:st=0:d=0.5`;

  const out = join(dir, "title.mp4");

  if (bgFile) {
    // Photo backdrop: cover-crop + slow Ken Burns, then scrim + text.
    const frames = Math.round(TITLE_SECS * FPS);
    const vf =
      `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,` +
      `zoompan=z='min(zoom+0.0009,1.12)':d=${frames}:s=${W}x${H}:fps=${FPS},` +
      textFilters;
    await run("ffmpeg", [
      "-y",
      "-i", bgFile,
      "-vf", vf,
      "-t", String(TITLE_SECS),
      "-r", String(FPS),
      "-c:v", VCODEC,
      "-pix_fmt", "yuv420p",
      "-b:v", "3M",
      out,
    ]);
    return out;
  }

  // Fallback: animated violet gradient.
  await run("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `gradients=s=${W}x${H}:c0=0x2a1a52:c1=0x0a0a0b:x0=0:y0=0:x1=${W}:y1=${H}:nb_colors=2:speed=0.012:duration=${TITLE_SECS}`,
    "-vf", textFilters,
    "-t", String(TITLE_SECS),
    "-r", String(FPS),
    "-c:v", VCODEC,
    "-pix_fmt", "yuv420p",
    "-b:v", "3M",
    out,
  ]);
  return out;
}

// Cover-crop Ken Burns slideshow from framable photo files → clip, or null.
async function renderPhotoSlides(dir: string, files: string[]): Promise<string | null> {
  if (files.length < 1) return null;
  const parts = files.map((_, i) => clipFilter(i));
  let last = "v0";
  for (let i = 1; i < files.length; i++) {
    const out = i === files.length - 1 ? "vout" : `x${i}`;
    const offset = i * CLIP_SECS - i * XFADE - XFADE;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${XFADE}:offset=${offset.toFixed(2)}[${out}]`);
    last = out;
  }
  const map = files.length === 1 ? "[v0]" : "[vout]";
  const outPath = join(dir, "slides.mp4");
  await run("ffmpeg", [
    "-y",
    ...files.flatMap((f) => ["-i", f]),
    "-filter_complex", parts.join(";"),
    "-map", map,
    "-r", String(FPS),
    "-c:v", VCODEC,
    "-pix_fmt", "yuv420p",
    "-b:v", "3M",
    outPath,
  ]);
  return outPath;
}

/**
 * Branded reel: a clean title card, plus the provider's framable photos as
 * extra slides when we find good ones. Always produces a watchable video.
 * Returns the files + which photo URLs were used (for the gallery), or null
 * only if even the title card can't render (no font / no ffmpeg).
 */
export async function renderBrandedReel(
  info: { name: string; category: string; city: string; slug: string },
  imageUrls: string[],
): Promise<{ dir: string; videoPath: string; posterPath: string; galleryUrls: string[] } | null> {
  const font = await findFont();
  if (!font) return null;

  const dir = await mkdtemp(join(tmpdir(), "peekreel-"));
  try {
    // Category-relevant backdrop for the title card (null → gradient fallback).
    let bgFile: string | null = join(dir, "bg");
    const bgUrl = categoryBackground(info.category, info.slug);
    if (!(await download(bgUrl, bgFile))) bgFile = null;

    const title = await renderTitleCard(dir, font, info, bgFile);

    // Framable photos (shared download for gallery + slides).
    const good = await selectFramablePhotos(imageUrls, dir, 4).catch(() => []);
    const galleryUrls = good.map((g) => g.url);

    let videoPath = title;
    let posterAt = 1.2;
    if (good.length >= 1) {
      const slides = await renderPhotoSlides(dir, good.map((g) => g.file)).catch(() => null);
      if (slides) {
        const combined = join(dir, "out.mp4");
        const offset = (TITLE_SECS - XFADE).toFixed(2);
        await run("ffmpeg", [
          "-y",
          "-i", title,
          "-i", slides,
          "-filter_complex", `[0:v][1:v]xfade=transition=fade:duration=${XFADE}:offset=${offset}[v]`,
          "-map", "[v]",
          "-r", String(FPS),
          "-c:v", VCODEC,
          "-pix_fmt", "yuv420p",
          "-b:v", "3M",
          "-movflags", "+faststart",
          combined,
        ]);
        videoPath = combined;
        posterAt = TITLE_SECS + 1.2; // show a photo in the poster
      }
    }

    const posterPath = join(dir, "poster.jpg");
    await run("ffmpeg", ["-y", "-ss", String(posterAt), "-i", videoPath, "-frames:v", "1", "-q:v", "3", posterPath]);

    const v = await readFile(videoPath).catch(() => null);
    if (!v || v.byteLength < 10_000) {
      await rm(dir, { recursive: true, force: true });
      return null;
    }
    return { dir, videoPath, posterPath, galleryUrls };
  } catch {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
}
