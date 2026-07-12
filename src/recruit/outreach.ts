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

  const subject = `I built you a ${BRAND} profile — ${p.city} clients are watching`;

  const text = [
    `Hey ${first},`,
    ``,
    `I run ${BRAND} — a video-first marketplace where ${p.city} clients scroll short clips from local ${cat} pros and book the one they like (think TikTok, but everyone on it is a bookable local provider).`,
    ``,
    `I already set up a profile for ${p.name} so you don't have to start from scratch. It's reserved for you and hidden until you claim it — takes about 2 minutes to make it live: just add a short intro video (or a few photos) and your booking link.`,
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
<p>I already set up a profile for <strong>${p.name}</strong> so you don't have to start from scratch. It's reserved for you and hidden until you claim it — about 2 minutes to make it live: add a short intro video (or a few photos) and your booking link.</p>
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

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text }),
  });
  const body = await resp.text();
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${body.slice(0, 200)}`);
  try {
    return JSON.parse(body) as { id?: string };
  } catch {
    return {};
  }
}

async function main() {
  const live = flag("live");
  const max = Number(arg("max") ?? "20");
  const categoryName = arg("category");
  const city = arg("city");
  const delayMs = Number(arg("delay") ?? "5000");

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
