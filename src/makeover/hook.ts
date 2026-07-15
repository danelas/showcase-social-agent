/**
 * Write a short, punchy opening hook overlaid on the first ~1.5s of the clip —
 * the line that makes someone stop scrolling. Uses Claude Haiku (same model +
 * forced-tool pattern as recruit/ai.ts).
 *
 * Fail-open: no ANTHROPIC_API_KEY or an error falls back to a simple hook built
 * from the service, so the render never blocks on this.
 */
import Anthropic from "@anthropic-ai/sdk";

const AI_MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

function fallbackHook(service: string): string {
  const s = service.trim();
  return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : "Watch This";
}

export async function writeHook(input: {
  name: string;
  service: string;
  transcript: string;
}): Promise<string> {
  const client = getClient();
  if (!client) return fallbackHook(input.service);

  const prompt = `You write scroll-stopping opening hooks for short local-business videos (Reels/TikTok). Given a business and a transcript of their clip, write ONE punchy on-screen hook that appears in the first 1.5 seconds.

Rules:
- 2 to 6 words. Shorter is better.
- Concrete and curiosity-driven, not generic ("POV: your best skin yet" beats "Great results").
- No hashtags, no emojis, no quotes, no ending period.
- Speak to the customer, not about the business in third person.

Business: ${input.name}
What they do: ${input.service}
Transcript: ${input.transcript.slice(0, 800) || "(no speech detected)"}`;

  try {
    const msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 100,
      tool_choice: { type: "tool", name: "write_hook" },
      tools: [
        {
          name: "write_hook",
          description: "Return the opening hook text.",
          input_schema: {
            type: "object",
            properties: { hook: { type: "string", description: "2-6 word opening hook" } },
            required: ["hook"],
          },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content.find((b) => b.type === "tool_use") as
      | { input?: { hook?: string } }
      | undefined;
    const hook = block?.input?.hook?.trim();
    if (hook) return hook.replace(/^["']|["']$/g, "").replace(/[.]+$/, "").slice(0, 40);
    return fallbackHook(input.service);
  } catch (e) {
    console.log(`     hook AI error: ${(e as Error).message}`);
    return fallbackHook(input.service);
  }
}
