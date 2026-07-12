/**
 * AI copy for draft profiles. Mirrors the PeekScout app's /api/ai/profile
 * helper (same model, same forced-tool-call pattern, similar prompt) so drafts
 * created by the recruiter read like profiles made with the in-app "Write with
 * AI" button.
 *
 * Fail-open: if ANTHROPIC_API_KEY is unset or the call errors, returns null
 * and the draft is created without copy — outreach never blocks on this.
 */
import Anthropic from "@anthropic-ai/sdk";

// Cheap + fast; plenty for short marketing copy. Matches the app's AI_MODEL.
const AI_MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}

export type ProfileCopy = { headline: string; bio: string; tags: string[] };

export async function generateProfileCopy(p: {
  name: string;
  categoryName: string;
  city: string;
}): Promise<ProfileCopy | null> {
  const client = getClient();
  if (!client) return null;

  const prompt = `You are writing marketing copy for a local service provider's video-channel profile on a booking app. Be warm, specific, and human — not corporate or generic. Avoid clichés like "unparalleled" or "we pride ourselves". This is a pre-built draft the owner will review and can edit, so keep claims safe and generic to the category — do not invent specific credentials, years in business, or prices.

Provider: ${p.name}
Category: ${p.categoryName}
City / area: ${p.city}

Write:
- headline: one punchy line (max ~8 words) that says what they do + a hook. No period.
- bio: 2-4 sentences, first-person, natural, that make a local client want to book. Weave in the service + city naturally for SEO, but do not keyword-stuff.
- tags: 5-8 lowercase search terms a client would actually type (e.g. "deep tissue massage", "acne scar facial").`;

  try {
    const msg = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 700,
      tool_choice: { type: "tool", name: "write_profile" },
      tools: [
        {
          name: "write_profile",
          description: "Return the generated profile copy.",
          input_schema: {
            type: "object",
            properties: {
              headline: { type: "string" },
              bio: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
            },
            required: ["headline", "bio", "tags"],
          },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });

    const tool = msg.content.find((c) => c.type === "tool_use");
    if (!tool || tool.type !== "tool_use") return null;
    const out = tool.input as Partial<ProfileCopy>;
    const headline = String(out.headline || "").trim();
    const bio = String(out.bio || "").trim();
    const tags = Array.isArray(out.tags)
      ? out.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [];
    if (!headline && !bio) return null;
    return { headline, bio, tags };
  } catch (e) {
    console.log(`     (ai copy skipped: ${(e as Error).message})`);
    return null;
  }
}
