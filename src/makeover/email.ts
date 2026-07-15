/**
 * Deliver the finished makeover: emails the provider a download link + cover
 * preview, and invites them to claim a free PeekScout profile. Same Resend
 * setup as recruit/outreach.ts.
 */
const BRAND = process.env.RECRUIT_BRAND || "PeekScout";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function sendMakeoverEmail(opts: {
  to: string;
  name: string;
  resultUrl: string;
  coverUrl: string | null;
}): Promise<{ id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");
  const replyTo = process.env.RESEND_REPLY_TO || "danamazon6@gmail.com";

  const subject = `Your ${BRAND} video makeover is ready, ${opts.name}`;
  const listUrl = `${APP_URL}/create`;

  const text = [
    `Hey — here's the free ${BRAND} makeover of your video.`,
    ``,
    `We reformatted it vertical, added captions, a stronger opening hook, a cover image, and your business name. It's yours — download it and post it on Instagram or TikTok too.`,
    ``,
    `Download your video:`,
    opts.resultUrl,
    ``,
    `Want clients finding you like this every day? List ${opts.name} on ${BRAND} free — it takes about 2 minutes:`,
    listUrl,
    ``,
    `— Dan, ${BRAND}`,
  ].join("\n");

  const cover = opts.coverUrl
    ? `<p><img src="${opts.coverUrl}" alt="Your makeover cover" style="max-width:280px;border-radius:12px"/></p>`
    : "";

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;color:#222;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">
<p>Hey — here's the free <strong>${BRAND}</strong> makeover of your video.</p>
<p>We reformatted it vertical, added captions, a stronger opening hook, a cover image, and your business name. It's yours — download it and post it on Instagram or TikTok too.</p>
${cover}
<p><a href="${opts.resultUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Download your video</a></p>
<p style="color:#666;font-size:13px">or paste this link: <a href="${opts.resultUrl}">${opts.resultUrl}</a></p>
<p>Want clients finding you like this every day? <a href="${listUrl}">List ${opts.name} on ${BRAND}</a> free — about 2 minutes.</p>
<p>— Dan, ${BRAND}</p>
</body></html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: opts.to, reply_to: replyTo, subject, html, text }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body) as { id?: string };
  } catch {
    return {};
  }
}
