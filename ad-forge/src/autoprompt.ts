import { GoogleGenAI } from "@google/genai";

/**
 * Auto-writes ad creative with a Gemini text model — reuses GEMINI_API_KEY,
 * so no extra key is needed. Given a category + vibe, it returns a
 * PHOTOREALISTIC Veo prompt (real people, real service, cinematic — like a
 * high-end commercial) plus punchy captions and a CTA.
 */
const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL || "gemini-flash-latest";

let _ai: GoogleGenAI | null = null;
function client(): GoogleGenAI {
  if (_ai) return _ai;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (needed for auto-prompt).");
  _ai = new GoogleGenAI({ apiKey });
  return _ai;
}

export type Creative = {
  veoPrompt: string;
  captions: { text: string; accent: boolean }[];
  cta: string;
  postCaption: string;
};

export type AutoInput = {
  brandName: string;
  tagline?: string;
  category: string;
  vibe?: string;
  offer?: string;
  aspect: string;
  seconds: number;
};

export async function writeCreative(input: AutoInput): Promise<Creative> {
  const vibe = input.vibe || "realistic premium commercial";
  const instruction = `You are an award-winning ad creative director and Veo prompt engineer.
Write the creative for a ${input.seconds}-second ${input.aspect} social video ad.

Brand: ${input.brandName}${input.tagline ? ` — "${input.tagline}"` : ""}
Category: ${input.category}
Offer/message: ${input.offer || "(none given — infer from category)"}
Vibe: ${vibe}

Return ONLY a JSON object (no markdown, no code fence) with exactly these keys:
{
  "veoPrompt": string,   // the Veo text-to-video prompt
  "captions": [ { "text": string, "accent": boolean }, ... ],  // exactly 3
  "cta": string,         // 2-4 words, e.g. "Get ${input.brandName}"
  "postCaption": string  // social caption for the POST (see rules)
}

Rules for "veoPrompt":
- PHOTOREALISTIC and cinematic — like real high-end commercial b-roll of the ACTUAL service being performed. Real humans, real ${input.category} environment, believable and warm.
- Describe: subject + action, setting, wardrobe, lighting, camera movement, lens/depth-of-field, mood, and color grade. One vivid paragraph.
- Show the service happening (e.g. a professional performing the treatment, a happy client) — NOT abstract textures.
- MUST end with exactly: "No on-screen text, no captions, no app UI, no phone screens, no watermarks, no logos."
- Do NOT depict any phone, app, screen, or interface — those are added separately.

Rules for "captions":
- 3 short punchy lines, 2-4 words each, matching the "${vibe}" energy.
- Exactly ONE caption has "accent": true (the key line); the others false.
- No hashtags, no emojis.

Rules for "postCaption":
- 1-2 upbeat sentences for the social post that sell ${input.brandName} and the offer.
- End with 3-5 relevant lowercase hashtags. At most one emoji. No @mentions.`;

  const ai = client();
  const res: any = await ai.models.generateContent({
    model: TEXT_MODEL(),
    contents: instruction,
    config: {
      responseMimeType: "application/json",
      temperature: 1.0,
      // Give the JSON room to finish. Without a budget, the model's default
      // output cap plus 2.5-Flash "thinking" tokens truncate longer creatives
      // (e.g. skincare/photography) mid-string → JSON.parse fails.
      maxOutputTokens: 2048,
      // Thinking tokens count against the output budget and aren't needed for
      // this structured task — turn them off so the whole JSON always fits.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const raw: string = (res.text ?? "").trim();
  const jsonText = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const finish = res?.candidates?.[0]?.finishReason;
    const why = finish && finish !== "STOP" ? ` (finishReason=${finish})` : "";
    throw new Error(`Auto-prompt returned non-JSON${why}:\n${raw.slice(0, 400)}`);
  }

  const captions = Array.isArray(parsed.captions)
    ? parsed.captions
        .slice(0, 3)
        .map((c: any) => ({ text: String(c.text ?? ""), accent: !!c.accent }))
    : [];
  if (!captions.some((c: any) => c.accent) && captions[1]) captions[1].accent = true;

  return {
    veoPrompt: String(parsed.veoPrompt ?? "").trim(),
    captions,
    cta: String(parsed.cta ?? `Get ${input.brandName}`).trim(),
    postCaption: String(parsed.postCaption ?? "").trim(),
  };
}
