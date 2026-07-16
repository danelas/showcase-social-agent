import { existsSync, readFileSync } from "node:fs";
import { postVideo } from "./post.ts";

// Load .env if present (Node >= 20.6).
try {
  (process as any).loadEnvFile?.(".env");
} catch {
  /* rely on real env */
}

/**
 * Post a rendered ad to social via upload-post:
 *   npm run post -- out/<base>.mp4 out/<base>.props.json
 * Platforms come from ADFORGE_PLATFORMS (comma-separated), e.g. "tiktok,instagram".
 */
async function main() {
  const mp4 = process.argv[2];
  const propsPath = process.argv[3];
  if (!mp4 || !existsSync(mp4)) {
    console.error(`usage: npm run post -- <video.mp4> <props.json>  (video not found: ${mp4})`);
    process.exit(1);
  }

  const platforms = (process.env.ADFORGE_PLATFORMS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (platforms.length === 0) {
    console.error("ADFORGE_PLATFORMS not set (e.g. ADFORGE_PLATFORMS=tiktok,instagram).");
    process.exit(1);
  }

  let caption = "";
  let title = "";
  if (propsPath && existsSync(propsPath)) {
    const props = JSON.parse(readFileSync(propsPath, "utf8"));
    caption = props?.post?.caption ?? "";
    title = props?.post?.title ?? "";
  }
  if (!caption) caption = process.env.ADFORGE_CAPTION ?? "";
  if (!title) title = caption.slice(0, 90) || "New video";

  const res = await postVideo({ mediaPath: mp4, title, caption, platforms });
  console.log("\n✓ posted:", JSON.stringify(res)?.slice(0, 300));
}

main().catch((e) => {
  console.error("\n✗ post failed:", e.message ?? e);
  process.exit(1);
});
