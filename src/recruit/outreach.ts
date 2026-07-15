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
  abReport,
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

// Safety switch. Until the makeover pipeline is verified end-to-end on a real
// clip, leave MAKEOVER_LIVE unset/false: makeover-assigned prospects then get
// the classic claim email instead (and are recorded as "claim", so the A/B
// report stays honest — nobody is counted in the makeover arm without seeing it).
// Flip MAKEOVER_LIVE=true once a good render is confirmed to launch the arm.
const MAKEOVER_LIVE = /^(1|true|yes|on)$/i.test(process.env.MAKEOVER_LIVE || "");

// Downgrade the makeover arm to claim while the switch is off.
function effectiveVariant(assigned: EmailVariant): EmailVariant {
  return assigned === "makeover" && !MAKEOVER_LIVE ? "claim" : assigned;
}

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

export type EmailVariant = "makeover" | "claim";

// Sticky 50/50 first-touch A/B, derived from the prospect id so it's stable
// across re-runs even before we persist it. Half get the makeover-led email,
// half the classic "claim your profile" email — compare with --report.
export function emailVariantFor(id: string): EmailVariant {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 2 === 0 ? "makeover" : "claim";
}

function renderFirstTouch(
  p: Sendable,
  claimUrl: string,
  variant: EmailVariant,
): { subject: string; text: string; html: string } {
  return variant === "makeover" ? renderMakeoverEmail(p, claimUrl) : renderClaimEmail(p, claimUrl);
}

// VARIANT A — lead with the free Video Makeover offer.
function renderMakeoverEmail(p: Sendable, claimUrl: string): { subject: string; text: string; html: string } {
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

// VARIANT B — the classic "I already built your profile, claim it" email.
function renderClaimEmail(p: Sendable, claimUrl: string): { subject: string; text: string; html: string } {
  const first = firstName(p);
  const cat = p.categoryName.toLowerCase();

  const subject = `I built you a ${BRAND} profile — ${p.city} clients are watching`;

  const text = [
    `Hey ${first},`,
    ``,
    `I run ${BRAND} — a video-first marketplace where ${p.city} clients scroll short clips from local ${cat} pros and book the one they like (think TikTok, but everyone on it is a bookable local provider).`,
    ``,
    `I already set up a profile for ${p.name} so you don't have to start from scratch. It's reserved for you and hidden until you claim it — takes about 2 minutes to make it live: just add a short intro video (or a few photos).`,
    ``,
    `Claim your profile here:`,
    `${claimUrl}`,
    ``,
    `Listings are free. Clients book/message/call you directly — no lead fees, no middleman.`,
    ``,
    `Not interested? Reply "no thanks" and I'll delete the profile and won't reach out again.`,
    ``,
    `— Dan, ${BRAND}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;color:#222;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">
<p>Hey ${first},</p>
<p>I run <strong>${BRAND}</strong> — a video-first marketplace where ${p.city} clients scroll short clips from local ${cat} pros and book the one they like (think TikTok, but everyone on it is a bookable local provider).</p>
<p>I already set up a profile for <strong>${p.name}</strong> so you don't have to start from scratch. It's reserved for you and hidden until you claim it — about 2 minutes to make it live: add a short intro video (or a few photos).</p>
<p><a href="${claimUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Claim your profile</a></p>
<p style="color:#666;font-size:13px">or paste this link: <a href="${claimUrl}">${claimUrl}</a></p>
<p>Listings are free. Clients book/message/call you directly — no lead fees, no middleman.</p>
<p>Not interested? Reply "no thanks" and I'll delete the profile and won't reach out again.</p>
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

// Resolve which A/B arm a prospect is in — prefer the stored variant, fall back
// to the deterministic assignment (covers rows sent before the column existed).
function resolveVariant(stored: string | null, id: string): EmailVariant {
  // Honor what they actually received on the first touch; only apply the switch
  // to the fallback (pre-A/B rows with no stored variant).
  if (stored === "makeover" || stored === "claim") return stored;
  return effectiveVariant(emailVariantFor(id));
}

// Second-touch nudge, matched to the prospect's first-touch A/B variant so the
// experience (and the experiment) stays consistent end-to-end.
function renderFollowup(
  p: Sendable,
  claimUrl: string,
  variant: EmailVariant,
): { subject: string; text: string; html: string } {
  return variant === "makeover" ? renderMakeoverFollowup(p, claimUrl) : renderClaimFollowup(p, claimUrl);
}

// Follow-up for the makeover arm — nudge them to still grab the free makeover.
function renderMakeoverFollowup(p: Sendable, claimUrl: string): { subject: string; text: string; html: string } {
  const first = firstName(p);
  const makeoverUrl =
    `${APP_URL}/makeover?b=${encodeURIComponent(p.name)}` +
    `&s=${encodeURIComponent(p.categoryName)}&src=recruit-fu`;

  const subject = `Still up for a free video makeover, ${p.name}?`;

  const text = [
    `Hey ${first},`,
    ``,
    `Quick nudge — my offer still stands. Send me one of your Instagram or TikTok videos and I'll make it over free: captions, a stronger opening hook, a clean cover, vertical format, and ${p.name} on it. You get it back to download and repost anywhere.`,
    ``,
    `Grab it here (about 30 seconds):`,
    `${makeoverUrl}`,
    ``,
    `(Your ${BRAND} profile is still reserved too — claim it anytime: ${claimUrl})`,
    ``,
    `Not interested? Reply "no thanks" and I won't reach out again.`,
    ``,
    `— Dan, ${BRAND}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;color:#222;line-height:1.55;max-width:560px;margin:0 auto;padding:24px">
<p>Hey ${first},</p>
<p>Quick nudge — my offer still stands. Send me one of your Instagram or TikTok videos and I'll <strong>make it over free</strong>: captions, a stronger opening hook, a clean cover, vertical format, and <strong>${p.name}</strong> on it. You get it back to download and repost anywhere.</p>
<p><a href="${makeoverUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Get my free makeover</a></p>
<p style="color:#666;font-size:13px">or paste this link: <a href="${makeoverUrl}">${makeoverUrl}</a></p>
<p style="color:#666;font-size:13px">Your ${BRAND} profile is still reserved too — <a href="${claimUrl}">claim it anytime</a>.</p>
<p>Not interested? Reply "no thanks" and I won't reach out again.</p>
<p>— Dan, ${BRAND}</p>
</body></html>`;

  return { subject, text, html };
}

// Follow-up for the claim arm — the classic "still holding your profile" nudge.
function renderClaimFollowup(p: Sendable, claimUrl: string): { subject: string; text: string; html: string } {
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
    const variant = resolveVariant(p.emailVariant, p.id);
    console.log(`${tag} → ${to}  (${p.name}, ${p.city})`);
    if (!live) {
      if (i < 5) console.log(`     [${variant}] subject: ${renderFollowup(p, claimUrl, variant).subject}`);
      continue;
    }
    try {
      const { subject, text, html } = renderFollowup(p, claimUrl, variant);
      await sendViaResend({ to, subject, text, html });
      await markFollowedUp(p.id);
      sent++;
      console.log(`     ✓ [${variant}] follow-up sent`);
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

  if (flag("report")) {
    await abReport();
    return;
  }

  if (flag("followup")) {
    await runFollowup(live, max, delayMs);
    return;
  }

  const batch = await getSendable({ limit: max, categoryName, city });

  console.log(`[outreach] ${batch.length} eligible prospects (cap ${max})`);
  console.log(`[outreach] mode: ${live ? "LIVE — creating profiles + sending" : "DRY-RUN (no profiles created)"}`);
  console.log(
    `[outreach] makeover arm: ${MAKEOVER_LIVE ? "ON" : "OFF (makeover picks get the claim email)"}\n`,
  );

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
        const variant = effectiveVariant(emailVariantFor(p.id));
        const { subject, text } = renderFirstTouch(p, `${APP_URL}/claim/<token>`, variant);
        console.log(`     [${variant}] subject: ${subject}`);
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
      const variant = effectiveVariant(emailVariantFor(p.id));
      const { subject, text, html } = renderFirstTouch(p, claimUrl, variant);
      const { id } = await sendViaResend({ to, subject, text, html });
      await markSent(p.id, {
        providerId: draft.providerId,
        claimToken: draft.claimToken,
        resendId: id ?? null,
        emailVariant: variant,
      });
      sent++;
      console.log(`     ✓ [${variant}] profile /p/${draft.slug} · sent (${id ?? "no id"})`);
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
