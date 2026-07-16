import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Brand, Brief, DIMS, type CompiledAd } from "./types.ts";
import { downloadClip, generateClip } from "./veo.ts";

// Load .env if present (Node >= 20.6).
try {
  (process as any).loadEnvFile?.(".env");
} catch {
  /* no .env — rely on real env vars */
}

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MOCK = process.env.MOCK === "1";

async function main() {
  const briefPath = process.argv[2];
  if (!briefPath) {
    console.error("usage: npm run generate -- briefs/<name>.json");
    process.exit(1);
  }

  const brief = Brief.parse(JSON.parse(readFileSync(briefPath, "utf8")));
  const brandPath = join(ROOT, "brands", `${brief.brand}.json`);
  if (!existsSync(brandPath)) {
    throw new Error(`Brand not found: ${brandPath}`);
  }
  const brand = Brand.parse(JSON.parse(readFileSync(brandPath, "utf8")));

  const dims = DIMS[brief.aspect];
  const clipsDir = join(ROOT, "public", "clips");
  const outDir = join(ROOT, "out");
  mkdirSync(clipsDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const base = basename(briefPath).replace(/\.json$/i, "");
  const stamp = Date.now();

  console.log(
    `\n${brand.name} — ${brief.scenes.length} scene(s) @ ${brief.aspect}` +
      (MOCK ? "  [MOCK: no Veo calls]" : "")
  );

  const scenes: CompiledAd["scenes"] = [];

  for (let i = 0; i < brief.scenes.length; i++) {
    const s = brief.scenes[i];
    const durationInFrames = Math.round(s.seconds * brief.fps);
    let clip: string | null = null;

    if (!MOCK) {
      const target = join(clipsDir, `${base}-s${i}-${stamp}.mp4`);
      console.log(`\n[scene ${i + 1}] ${s.source.type}`);

      const op = await generateClip(
        s.source.type === "image2video"
          ? {
              kind: "image2video",
              prompt: s.prompt,
              aspect: brief.aspect,
              seconds: s.seconds,
              imagePath: resolveAsset(
                isAbsolute(brand.assetsDir)
                  ? brand.assetsDir
                  : join(ROOT, brand.assetsDir),
                s.source.image
              ),
            }
          : {
              kind: "text2video",
              prompt: s.prompt,
              aspect: brief.aspect,
              seconds: s.seconds,
            },
        (m) => console.log(m)
      );

      await downloadClip(op, target);
      clip = `clips/${basename(target)}`;
      console.log(`  saved ${clip}`);
    } else {
      console.log(`\n[scene ${i + 1}] ${s.source.type} — skipped (mock)`);
    }

    scenes.push({
      clip,
      durationInFrames,
      headline: s.headline,
      subhead: s.subhead,
      cta: s.cta,
      bubbles: s.bubbles,
    });
  }

  const compiled: CompiledAd = {
    width: dims.width,
    height: dims.height,
    fps: brief.fps,
    brand: {
      name: brand.name,
      accent: brand.accent,
      ink: brand.ink,
      tagline: brand.tagline,
      logo: brand.logo ?? null,
      fontFamily: brand.fontFamily,
    },
    scenes,
  };

  const propsPath = join(outDir, `${base}.props.json`);
  writeFileSync(propsPath, JSON.stringify(compiled, null, 2));

  console.log(`\n✓ props written: out/${base}.props.json`);
  console.log(`\nNext, render the ad:`);
  console.log(
    `  npx remotion render Ad out/${base}.mp4 --props=out/${base}.props.json\n`
  );
}

function resolveAsset(assetsDir: string, image: string): string {
  const direct = isAbsolute(image) ? image : join(assetsDir, image);
  if (existsSync(direct)) return direct;
  throw new Error(
    `image2video source not found: "${image}" (looked in ${assetsDir})`
  );
}

main().catch((e) => {
  console.error("\n✗", e.message ?? e);
  process.exit(1);
});
