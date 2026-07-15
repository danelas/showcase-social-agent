/**
 * Cold-outreach sender. Pulls NEW prospects, and for each one:
 *   1. creates an unclaimed draft Provider (their profile — no media yet, so it
 *      stays out of the public feed until they claim + add a video), then
 *   2. emails them the "we already built your profile, come claim it" pitch with
 *      the /claim/<token> link, then
 *   3. marks the prospect SENT (never emailed twice).
 *
 *   npx tsx scripts/recruit/outreach.ts                 # dry-run, previews 5
 *   npx tsx scripts/recruit/outreach.ts --live --max 20 # actually send
 *   npx tsx scripts/recruit/outreach.ts --category "Med Spa & Aesthetics"
 *
 * Safety: dry-run by default (--live required), cap 20/run, 5s between sends,
 * status column guarantees no double-sends across runs. In dry-run NO profile
 * is created — creation only happens on a live send.
 */
// Prisma auto-loads .env at import time (see db.ts → PrismaClient).
import {
  getSendable,
  createDraftProvider,
  markSent,
  markFailed,
  getFollowupBatch,
  claimedProviderIds,
  markFollowedUp,
  markConverted,
  prisma,
  type Sendable,
} from "./db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const BRAND = process.env.RECRUIT_BRAND || "PeekScout";

function firstName(p: Sendable): string {
  const local = p.primaryEmail?.split("@")[0] ?? "";
  if (!local) return "there";
  if (/^(info|contact|hello|hi|admin|support|booking|appointments|team|office|owner|sales|reception|concierge|frontdesk|desk|inquiries|enquiries|mail|email)$/i.test(local)) {
    return "there";
  }
  const head = local.split(/[._\-]/)[0].replace(/\d+$/, "");
  if (head.length < 2) return "there";
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase();
}

function renderEmail(p: Sendable, claimUrl: string): { subject: string; text: string; html: string } {
  const first = firstName(p);
  const cat = p.categoryName.toLowerCase();

  // Lead with the free Video Makeover (irresistible, no-commitment hook). The
  // reserved profile / claim link rides along as a lighter secondary CTA. The
  // makeover link prefills the /makeover form (business name + service) so it's
  // a 30-second submit.
  const makeoverUrl =
    `${APP_URL}/makeover?b=${encodeURIComponent(p.name)}` +
    `&s=${encodeURIComponent(p.categoryName)}&src=recruit`;

  const subject = `Free video makeover for ${p.name} — captions, hook, the works`;

  const text = [
    `Hey ${first},`,
    ``,
    `I run ${BRAND} — a video-first marketplace where ${p.city} clients scroll short clips from local ${cat} pros and book the one they like (think TikTok, but everyone on it is a bookable local provider).`,
    ``,
    `Want to see what good looks like, on the house? Send me one of your Instagram or TikTok videos and I'll make it over — free. I'll:`,
    `  • add captions`,
    `  • sharpen the opening hook`,
    `  • make a clean cover image`,
    `  • format it vertical for Reels/TikTok`,
    `  • put ${p.name} + your service right on it`,
    ``,
    `You get it back to download and repost anywhere — no strings.`,
    ``,
    `Start here (about 30 seconds):`,
    `${makeoverUrl}`,
    ``,
    `(I also reserved you a free ${BRAND} profile so ${p.city} clients can find you — claim it anytime: ${claimUrl})`,
    ``,
    `Not interested? Reply "no thanks" and I won't reach out again.`,
    ``,
    `— Dan, ${BRAND}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;color:#222;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">
<p>Hey ${first},</p>
<p>I run <strong>${BRAND}</strong> — a video-first marketplace where ${p.city} clients scroll short clips from local ${cat} pros and book the one they like (think TikTok, but everyone on it is a bookable local provider).</p>
<p>Want to see what good looks like, on the house? Send me one of your Instagram or TikTok videos and I'll <strong>make it over — free</strong>:</p>
<ul style="margin:0 0 4px;padding-left:20px;color:#333">
<li>add captions</li>
<li>sharpen the opening hook</li>
<li>make a clean cover image</li>
<li>format it vertical for Reels/TikTok</li>
<li>put <strong>${p.name}</strong> + your service right on it</li>
</ul>
<p>You get it back to download and repost anywhere — no strings.</p>
<p><a href="${makeoverUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Get my free makeover</a></p>
<p style="color:#666;font-size:13px">or paste this link: <a href="${makeoverUrl}">${makeoverUrl}</a></p>
<p style="color:#666;font-size:13px">I also reserved you a free ${BRAND} profile so ${p.city} clients can find you — <a href="${claimUrl}">claim it anytime</a>.</p>
<p>Not interested? Reply "no thanks" and I won't reach out again.</p>
<p>— Dan, ${BRAND}</p>
</body></html>`;

  return { subject, text, html };
}

async function sendViaResend(opts: { to: string; subject: string; text: string; html: string }): Promise<{ id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  if (!from) throw new Error("RESEND_FROM_EMAIL not set");

  // Replies land in the operator's real inbox, not the send-only sender
  // domain. Overridable via env; defaults to Dan's Gmail.
  const replyTo = process.env.RESEND_REPLY_TO || "danamazon6@gmail.com";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: opts.to,
      reply_to: replyTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body) as { id?: string };
  } catch {
    return {};
  }
}

// Second-touch nudge for prospects who got the first email but haven't claimed.
function renderFollowup(p: Sendable, claimUrl: string): { subject: string; text: string; html: string } {
  const first = firstName(p);
  const cat = p.categoryName.toLowerCase();

  const subject = `Still holding your ${BRAND} profile, ${p.name}`;

  const text = [
    `Hey ${first},`,
    ``,
    `Quick nudge — the ${BRAND} profile I set up for ${p.name} is still reserved for you. ${p.city} clients are scrolling ${cat} clips and booking right now, and yours goes live the minute you add a short video (about 2 minutes).`,
    ``,
    `Claim it here:`,
    `${claimUrl}`,
    ``,
    `Free to list, and clients book/message/call you directly — no lead fees. If it's not for you, just reply "no thanks" and I'll take the profile down.`,
    ``,
    `— Dan, ${BRAND}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;color:#222;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">
<p>Hey ${first},</p>
<p>Quick nudge — the <strong>${BRAND}</strong> profile I set up for <strong>${p.name}</strong> is still reserved for you. ${p.city} clients are scrolling ${cat} clips and booking right now, and yours goes live the minute you add a short video (about 2 minutes).</p>
<p><a href="${claimUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Claim your profile</a></p>
<p style="color:#666;font-size:13px">or paste this link: <a href="${claimUrl}">${claimUrl}</a></p>
<p>Free to list, and clients book/message/call you directly — no lead fees. If it's not for you, just reply "no thanks" and I'll take the profile down.</p>
<p>— Dan, ${BRAND}</p>
</body></html>`;

  return { subject, text, html };
}

async function runFollowup(live: boolean, max: number, delayMs: number) {
  const minAgeDays = Number(arg("min-age-days") ?? "3");
  const batch = await getFollowupBatch({ limit: max, minAgeDays });
  console.log(`[followup] ${batch.length} prospects emailed ≥${minAgeDays}d ago and still SENT (cap ${max})`);
  console.log(`[followup] mode: ${live ? "LIVE" : "DRY-RUN"}\n`);
  if (batch.length === 0) {
    console.log("Nothing to follow up.");
    return;
  }

  // Skip (and mark CONVERTED) anyone who already claimed since the first email.
  const claimed = await claimedProviderIds(batch.map((b) => b.providerId));

  let sent = 0, converted = 0, failed = 0;
  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    const tag = `[${i + 1}/${batch.length}]`;
    if (claimed.has(p.providerId)) {
      await markConverted(p.id).catch(() => {});
      converted++;
      console.log(`${tag} ${p.name} — already claimed ✓ marked CONVERTED, skipping`);
      continue;
    }
    const to = p.primaryEmail!;
    const claimUrl = `${APP_URL}/claim/${p.claimToken}`;
    console.log(`${tag} → ${to}  (${p.name}, ${p.city})`);
    if (!live) {
      if (i < 5) console.log(`     subject: ${renderFollowup(p, claimUrl).subject}`);
      continue;
    }
    try {
      const { subject, text, html } = renderFollowup(p, claimUrl);
      await sendViaResend({ to, subject, text, html });
      await markFollowedUp(p.id);
      sent++;
      console.log(`     ✓ follow-up sent`);
    } catch (e) {
      failed++;
      console.log(`     ✗ ${(e as Error).message}`);
    }
    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  console.log(`\n[followup] ${live ? "live" : "dry"} complete: ${sent} sent, ${converted} already-claimed, ${failed} failed`);
}

async function main() {
  const live = flag("live");
  const max = Number(arg("max") ?? "20");
  const categoryName = arg("category");
  const city = arg("city");
  const delayMs = Number(arg("delay") ?? "5000");

  if (flag("followup")) {
    await runFollowup(live, max, delayMs);
    return;
  }

  const batch = await getSendable({ limit: max, categoryName, city });

  console.log(`[outreach] ${batch.length} eligible prospects (cap ${max})`);
  console.log(`[outreach] mode: ${live ? "LIVE — creating profiles + sending" : "DRY-RUN (no profiles created)"}\n`);

  if (batch.length === 0) {
    console.log("Nothing to send. Run discover.ts to find more.");
    return;
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < batch.length; i++) {
    const p = batch[i];
    const to = p.primaryEmail!;
    const tag = `[${i + 1}/${batch.length}]`;
    console.log(`${tag} → ${to}  (${p.name}, ${p.city}, ${p.categoryName})`);

    if (!live) {
      if (i < 5) {
        const { subject, text } = renderEmail(p, `${APP_URL}/claim/<token>`);
        console.log(`     subject: ${subject}`);
        console.log(`     ${text.split("\n").slice(0, 3).join(" ⏎ ").slice(0, 150)}…`);
      }
      continue;
    }

    try {
      const draft = await createDraftProvider(p);
      if (!draft) {
        await markFailed(p.id, `category not found: ${p.categoryName}`);
        failed++;
        console.log(`     ✗ category "${p.categoryName}" not in db — skipped`);
        continue;
      }
      const claimUrl = `${APP_URL}/claim/${draft.claimToken}`;
      const { subject, text, html } = renderEmail(p, claimUrl);
      const { id } = await sendViaResend({ to, subject, text, html });
      await markSent(p.id, { providerId: draft.providerId, claimToken: draft.claimToken, resendId: id ?? null });
      sent++;
      console.log(`     ✓ profile /p/${draft.slug} · sent (${id ?? "no id"})`);
    } catch (e) {
      const error = (e as Error).message;
      try {
        await markFailed(p.id, error);
      } catch (markErr) {
        console.log(`     ✗ ${error} (markFailed errored: ${(markErr as Error).message})`);
      }
      failed++;
      console.log(`     ✗ ${error}`);
    }

    if (i < batch.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log(`\n[outreach] ${live ? "live" : "dry-run"} complete: ${sent} sent, ${failed} failed`);
  if (!live) console.log(`           re-run with --live to create profiles + send`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
