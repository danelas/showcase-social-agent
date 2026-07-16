import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Brand, Brief, DIMS, type CompiledAd } from "./types.ts";
import { downloadClip, generateClip } from "./veo.ts";
import { writeCreative } from "./autoprompt.ts";

// Load .env if present (Node >= 20.6).
try {
  (process as any).loadEnvFile?.(".env");
} catch {
  /* no .env — rely on real env vars */
}

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROMPT_ONLY = process.env.AUTOPROMPT_ONLY === "1";
const MOCK = process.env.MOCK === "1" || PROMPT_ONLY;

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
  const cardsDir = join(ROOT, "public", "cards");
  const outDir = join(ROOT, "out");
  const assetsRoot = isAbsolute(brand.assetsDir)
    ? brand.assetsDir
    : join(ROOT, brand.assetsDir);
  mkdirSync(clipsDir, { recursive: true });
  mkdirSync(cardsDir, { recursive: true });
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

    // Resolve the creative: hand-written, or auto-written by the LLM.
    let veoPrompt = s.prompt ?? "";
    let captions = s.captions;
    let cta = s.cta;
    if (s.auto) {
      console.log(`\n[scene ${i + 1}] auto-writing creative (${s.auto.category})…`);
      const creative = await writeCreative({
        brandName: brand.name,
        tagline: brand.tagline,
        category: s.auto.category,
        vibe: s.auto.vibe,
        offer: s.auto.offer,
        aspect: brief.aspect,
        seconds: s.seconds,
      });
      veoPrompt = creative.veoPrompt;
      if (captions.length === 0) captions = creative.captions;
      if (!cta) cta = creative.cta;
      console.log(`  VEO PROMPT: ${veoPrompt}`);
      console.log(`  CAPTIONS:   ${captions.map((c) => c.text).join("  |  ")}`);
      console.log(`  CTA:        ${cta}`);
    }
    if (!veoPrompt) {
      throw new Error(`Scene ${i + 1} has no prompt and no auto block.`);
    }

    if (!MOCK) {
      const target = join(clipsDir, `${base}-s${i}-${stamp}.mp4`);
      console.log(`\n[scene ${i + 1}] ${s.source.type}`);

      const op = await generateClip(
        s.source.type === "image2video"
          ? {
              kind: "image2video",
              prompt: veoPrompt,
              aspect: brief.aspect,
              seconds: s.seconds,
              imagePath: resolveAsset(assetsRoot, s.source.image),
            }
          : {
              kind: "text2video",
              prompt: veoPrompt,
              aspect: brief.aspect,
              seconds: s.seconds,
            },
        (m) => console.log(m)
      );

      await downloadClip(op, target);
      clip = `clips/${basename(target)}`;
      console.log(`  saved ${clip}`);
    } else {
      console.log(
        `\n[scene ${i + 1}] ${s.source.type} — ${
          PROMPT_ONLY ? "prompt-only (no Veo)" : "skipped (mock)"
        }`
      );
    }

    // Copy each card screenshot into public/cards so Remotion can staticFile it.
    const cards: string[] = [];
    for (const card of s.cards) {
      const src = resolveAsset(assetsRoot, card);
      const name = basename(src);
      copyFileSync(src, join(cardsDir, name));
      cards.push(`cards/${name}`);
    }

    scenes.push({
      clip,
      durationInFrames,
      cards,
      captions,
      headline: s.headline,
      subhead: s.subhead,
      cta,
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
