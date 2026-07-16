import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Render the Remotion composition to a JPEG frame sequence (Chrome only, no
 * ffmpeg encode) and stitch it with the SYSTEM ffmpeg using the hardware
 * h264_mf encoder. This box's bundled libx264 OOMs on 1080x1920; h264_mf
 * (Media Foundation) does not.
 *
 *   npm run compose -- out/<base>.props.json [out/<base>.mp4]
 */
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const propsPath = process.argv[2];
if (!propsPath) {
  console.error("usage: npm run compose -- out/<base>.props.json [out.mp4]");
  process.exit(1);
}

const base = basename(propsPath).replace(/\.props\.json$/i, "").replace(/\.json$/i, "");
const outMp4 = process.argv[3] || join(ROOT, "out", `${base}.mp4`);
const props = JSON.parse(readFileSync(propsPath, "utf8"));
const fps: number = props.fps ?? 30;

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, cwd: ROOT });
  if (r.status !== 0) {
    console.error(`\n✗ ${cmd} exited ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

// Cloud (Linux/CI) runners have enough RAM for Remotion's bundled libx264, so
// encode in one shot. Only this low-memory Windows box needs the frame-sequence
// + hardware h264_mf workaround.
const useDirect = process.env.CI === "true" || process.platform !== "win32";

if (useDirect) {
  console.log("→ rendering + encoding with Remotion (bundled ffmpeg)…");
  run("npx", [
    "remotion",
    "render",
    "Ad",
    JSON.stringify(outMp4),
    `--props=${JSON.stringify(propsPath)}`,
  ]);
  console.log(`\n🎬 done -> ${outMp4}`);
  process.exit(0);
}

const framesDir = join(ROOT, "out", "frames", base);
mkdirSync(framesDir, { recursive: true });

console.log("→ rendering frame sequence…");
run("npx", [
  "remotion",
  "render",
  "Ad",
  JSON.stringify(framesDir),
  "--sequence",
  "--image-format=jpeg",
  "--jpeg-quality=95",
  "--concurrency=1",
  `--props=${JSON.stringify(propsPath)}`,
]);

if (!existsSync(join(framesDir, "element-0.jpeg"))) {
  console.error("✗ no frames produced");
  process.exit(1);
}

console.log("\n→ encoding with h264_mf…");
run("ffmpeg", [
  "-y",
  "-framerate", String(fps),
  "-i", JSON.stringify(join(framesDir, "element-%d.jpeg")),
  "-c:v", "h264_mf",
  "-pix_fmt", "yuv420p",
  "-b:v", "10M",
  "-movflags", "+faststart",
  JSON.stringify(outMp4),
]);

// Frames can be hundreds of MB; drop them.
rmSync(framesDir, { recursive: true, force: true });

console.log(`\n🎬 done -> ${outMp4}`);
