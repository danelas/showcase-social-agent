/**
 * Speech-to-text for captions. Extracts a small mono WAV with ffmpeg, then
 * transcribes it with OpenAI's Whisper (whisper-1) — returns word-level
 * timestamps we use to build karaoke-style captions. Uses the same
 * OPENAI_API_KEY already configured for the project.
 *
 * whisper-1 is required for word timestamps: the newer gpt-4o-transcribe models
 * don't support verbose_json / timestamp_granularities.
 *
 * Fail-open: no OPENAI_API_KEY, silent audio, or an API error returns null and
 * the render simply skips captions.
 */
import { join } from "path";
import { readFile } from "fs/promises";
import { run } from "./proc";

export type Word = { word: string; start: number; end: number };
export type Transcript = { text: string; words: Word[] };

const WHISPER_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

// ffmpeg → 16kHz mono WAV (what Whisper wants; keeps the upload tiny).
async function extractAudio(videoPath: string, dir: string): Promise<string | null> {
  const out = join(dir, "audio.wav");
  try {
    await run("ffmpeg", ["-y", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", out], 90_000);
    return out;
  } catch {
    return null;
  }
}

export async function transcribe(videoPath: string, dir: string): Promise<Transcript | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("     OPENAI_API_KEY unset — skipping captions");
    return null;
  }

  const audio = await extractAudio(videoPath, dir);
  if (!audio) return null;

  try {
    const bytes = await readFile(audio);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "audio/wav" }), "audio.wav");
    form.append("model", WHISPER_MODEL);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      console.log(`     OpenAI transcribe ${res.status}: ${(await res.text()).slice(0, 160)}`);
      return null;
    }
    const data = (await res.json()) as {
      text?: string;
      words?: { word: string; start: number; end: number }[];
    };
    const words = (data.words || []).filter(
      (w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end),
    );
    if (!words.length) return null;
    return { text: (data.text || "").trim(), words };
  } catch (e) {
    console.log(`     transcribe error: ${(e as Error).message}`);
    return null;
  }
}
