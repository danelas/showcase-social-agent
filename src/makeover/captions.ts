/**
 * Turn word-level timestamps into a burned-in .ass subtitle file — short 2–3
 * word chunks that pop on screen in sync with speech (the TikTok/Reels caption
 * look). Positioned lower-center, above the brand bar.
 */
import { join } from "path";
import { writeFile } from "fs/promises";
import type { Word } from "./transcribe";

const MAX_WORDS = 3; // words per on-screen chunk
const MAX_CHUNK_SECS = 1.6; // don't hold a chunk longer than this
const GAP_SPLIT = 0.6; // a pause longer than this starts a new chunk

function fmt(t: number): string {
  if (t < 0) t = 0;
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

// ASS override braces / newlines would break a Dialogue line.
const escText = (s: string) => s.replace(/[{}]/g, "").replace(/\r?\n/g, " ").trim();

function chunkWords(words: Word[]): { start: number; end: number; text: string }[] {
  const chunks: { start: number; end: number; text: string }[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.word.trim()).join(" "),
    });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const gap = w.start - cur[cur.length - 1].end;
      const span = w.end - cur[0].start;
      if (cur.length >= MAX_WORDS || gap > GAP_SPLIT || span > MAX_CHUNK_SECS) flush();
    }
    cur.push(w);
  }
  flush();
  return chunks;
}

/**
 * Write an .ass caption file for the frame size, or null if there's nothing to
 * caption. `marginV` lifts the text off the bottom (above the brand bar).
 */
export async function writeCaptions(
  words: Word[],
  dir: string,
  opts: { w: number; h: number; marginV: number },
): Promise<string | null> {
  const chunks = chunkWords(words);
  if (!chunks.length) return null;

  // Bold white, thick black outline + soft shadow, all-caps for punch.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.w}
PlayResY: ${opts.h}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap, DejaVu Sans, 72, &H00FFFFFF, &H00FFFFFF, &H00000000, &H64000000, -1, 0, 0, 0, 100, 100, 0, 0, 1, 5, 2, 2, 60, 60, ${opts.marginV}, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const lines = chunks.map(
    (c) =>
      `Dialogue: 0,${fmt(c.start)},${fmt(c.end)},Cap,,0,0,0,,{\\fad(80,80)}${escText(c.text).toUpperCase()}`,
  );

  const out = join(dir, "captions.ass");
  await writeFile(out, `${header}\n${lines.join("\n")}\n`);
  return out;
}
