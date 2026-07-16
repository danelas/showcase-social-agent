import { z } from "zod";

/** Aspect ratios Veo can generate. */
export const Aspect = z.enum(["9:16", "16:9"]);
export type Aspect = z.infer<typeof Aspect>;

export const DIMS: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

/** A reusable brand definition (brands/<name>.json). */
export const Brand = z.object({
  name: z.string(),
  /** Primary accent color (buttons, sent bubbles). */
  accent: z.string().default("#7c3aed"),
  /** Text/ink color for light backgrounds. */
  ink: z.string().default("#141414"),
  /** One-liner shown near the logo. */
  tagline: z.string().default(""),
  /** Path to the logo PNG, relative to public/ (transparent bg recommended). */
  logo: z.string().optional(),
  /** Folder to pull image-to-video source assets from. */
  assetsDir: z.string(),
  /** CSS font stack used for all overlay text. */
  fontFamily: z.string().default("Segoe UI, Arial, Helvetica, sans-serif"),
});
export type Brand = z.infer<typeof Brand>;

/** Where a scene's footage comes from. */
export const Source = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image2video"),
    /** Filename inside the brand's assetsDir, or an absolute path. */
    image: z.string(),
  }),
  z.object({ type: z.literal("text2video") }),
]);

/** A chat-bubble overlay (like the reference DM ad). */
export const Bubble = z.object({
  side: z.enum(["in", "out"]),
  text: z.string(),
});

/** A punchy kinetic caption that pops in over the footage. */
export const Caption = z.object({
  text: z.string(),
  /** Render in the brand accent color (for the key word/line). */
  accent: z.boolean().default(false),
  /** Optional explicit start time (seconds). Omitted = auto-sequenced. */
  at: z.number().optional(),
});

/** Auto-write the Veo prompt + captions with an LLM instead of hand-writing. */
export const Auto = z.object({
  category: z.string(),
  vibe: z.string().default("realistic premium commercial"),
  offer: z.string().default(""),
});

/** One scene = one Veo clip + its overlays. */
export const Scene = z.object({
  source: Source,
  /** The Veo prompt describing the FOOTAGE (camera, mood, action) — not text.
   *  Optional when `auto` is set (the LLM writes it). */
  prompt: z.string().optional(),
  /** If set, an LLM auto-writes prompt/captions/cta from category + vibe. */
  auto: Auto.optional(),
  /** Seconds of footage to request (Veo 3 currently fixes this near 8). */
  seconds: z.number().min(2).max(8).default(8),
  /** Screenshots (filenames in the brand's assetsDir) shown as phone cards. */
  cards: z.array(z.string()).default([]),
  /** If true, cards slide in only for the last ~2.5s (an app "reveal") instead
   *  of floating the whole scene. Great for realistic footage-hero ads. */
  cardReveal: z.boolean().default(false),
  /** Kinetic captions that pop in sequence over the footage. */
  captions: z.array(Caption).default([]),
  /** Legacy static overlays (still supported). */
  headline: z.string().optional(),
  subhead: z.string().optional(),
  cta: z.string().optional(),
  bubbles: z.array(Bubble).default([]),
});

/** The human-authored input file (briefs/<name>.json). */
export const Brief = z.object({
  brand: z.string(),
  aspect: Aspect.default("9:16"),
  fps: z.number().default(30),
  scenes: z.array(Scene).min(1),
});
export type Brief = z.infer<typeof Brief>;

/** ---- Compiled props consumed by the Remotion composition ---- */
export const CompiledScene = z.object({
  /** Path to the clip relative to public/, or null for a gradient fallback. */
  clip: z.string().nullable(),
  durationInFrames: z.number(),
  /** Card image paths relative to public/. */
  cards: z.array(z.string()).default([]),
  cardReveal: z.boolean().default(false),
  captions: z.array(Caption).default([]),
  headline: z.string().optional(),
  subhead: z.string().optional(),
  cta: z.string().optional(),
  bubbles: z.array(Bubble).default([]),
});
export type CompiledScene = z.infer<typeof CompiledScene>;

export const CompiledAd = z.object({
  width: z.number(),
  height: z.number(),
  fps: z.number(),
  brand: z.object({
    name: z.string(),
    accent: z.string(),
    ink: z.string(),
    tagline: z.string(),
    logo: z.string().nullable(),
    fontFamily: z.string(),
  }),
  scenes: z.array(CompiledScene),
});
export type CompiledAd = z.infer<typeof CompiledAd>;
