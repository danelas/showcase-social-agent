import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Aspect } from "./types.ts";

const MODEL = process.env.VEO_MODEL || "veo-3.0-generate-001";

let _ai: GoogleGenAI | null = null;
/** Construct the client lazily so MOCK mode never needs a key. */
function client(): GoogleGenAI {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env and paste your paid Gemini key."
    );
  }
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export type VeoJob =
  | { kind: "text2video"; prompt: string; aspect: Aspect; seconds: number }
  | {
      kind: "image2video";
      prompt: string;
      imagePath: string;
      aspect: Aspect;
      seconds: number;
    };

/**
 * Kick off a Veo generation, poll until done, and return the finished
 * video handle. Veo is async: you get an operation and poll it.
 */
export async function generateClip(
  job: VeoJob,
  onTick?: (msg: string) => void
): Promise<any> {
  const ai = client();
  const config: Record<string, unknown> = {
    aspectRatio: job.aspect,
    numberOfVideos: 1,
    durationSeconds: job.seconds,
  };

  const req: Record<string, unknown> = { model: MODEL, prompt: job.prompt, config };

  if (job.kind === "image2video") {
    const bytes = readFileSync(job.imagePath);
    req.image = {
      imageBytes: bytes.toString("base64"),
      mimeType: mimeFor(job.imagePath),
    };
  }

  onTick?.(`submitting ${job.kind} to ${MODEL} (${job.aspect}, ${job.seconds}s)`);
  // @ts-expect-error SDK types vary across versions; the runtime shape is stable.
  let op = await ai.models.generateVideos(req);

  const started = Date.now();
  while (!op.done) {
    await sleep(10_000);
    op = await ai.operations.getVideosOperation({ operation: op });
    onTick?.(`  …rendering (${Math.round((Date.now() - started) / 1000)}s elapsed)`);
  }

  if (op.error) {
    throw new Error(`Veo failed: ${JSON.stringify(op.error)}`);
  }
  return op;
}

/** Download the first generated video from a finished operation to disk. */
export async function downloadClip(op: any, downloadPath: string): Promise<void> {
  const ai = client();
  const gen = op.response?.generatedVideos?.[0];
  if (!gen?.video) throw new Error("Veo returned no video in the response.");
  await ai.files.download({ file: gen.video, downloadPath });
}
