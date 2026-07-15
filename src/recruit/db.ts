/**
 * Prisma-backed state for the recruit engine. Unlike Gold Touch List (which
 * talks to a raw Supabase table), PeekScout already owns its Postgres via Prisma,
 * so we reuse the same client and models.
 *
 *   outreach_prospects  — one row per business found on Places (dedup + status)
 *   providers           — the draft profile we create when we send ("we made you
 *                          a profile"); unclaimed, no media so it stays out of
 *                          the feed until the real owner claims + adds a video.
 */
import { randomUUID } from "crypto";
import { PrismaClient, PricingUnit } from "@prisma/client";
import { slugify } from "./slug";
import { generateProfileCopy } from "./ai";
import { scrapePhotos } from "./scrape-photos";
import { renderBrandedReel } from "./render-video";
import { uploadMedia } from "./upload";
import { rm } from "fs/promises";
import { CITIES } from "./cities";

export const prisma = new PrismaClient();

export type Prospect = {
  placeKey: string;
  name: string;
  categoryName: string;
  city: string;
  state: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  emails: string[];
  primaryEmail: string | null;
  query: string | null;
};

// ─── Discovery ───────────────────────────────────────────────────────────────

/** All place_ids we've already recorded — for dedupe. */
export async function getKnownPlaceKeys(): Promise<Set<string>> {
  const rows = await prisma.outreachProspect.findMany({ select: { placeKey: true } });
  return new Set(rows.map((r) => r.placeKey));
}

export async function insertProspect(p: Prospect): Promise<void> {
  try {
    await prisma.outreachProspect.create({
      data: {
        placeKey: p.placeKey,
        name: p.name,
        categoryName: p.categoryName,
        city: p.city,
        state: p.state,
        address: p.address,
        phone: p.phone,
        website: p.website,
        emails: p.emails,
        primaryEmail: p.primaryEmail,
        query: p.query,
        status: "NEW",
      },
    });
  } catch (e) {
    // Unique-violation race (another runner inserted the same place): fine.
    if ((e as { code?: string }).code === "P2002") return;
    throw e;
  }
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export type Sendable = Prospect & { id: string };

type ProspectRow = Awaited<ReturnType<typeof prisma.outreachProspect.findMany>>[number];
const toSendable = (r: ProspectRow): Sendable => ({
  id: r.id,
  placeKey: r.placeKey,
  name: r.name,
  categoryName: r.categoryName,
  city: r.city,
  state: r.state,
  address: r.address,
  phone: r.phone,
  website: r.website,
  emails: r.emails,
  primaryEmail: r.primaryEmail,
  query: r.query,
});

/**
 * NEW prospects with a primary email. When no explicit city is requested,
 * target-market prospects (the current CITIES list) are emailed FIRST and any
 * legacy backlog (e.g. old Nashville prospects) only fills leftover slots — so
 * pointing the recruiter at new cities takes effect immediately instead of
 * waiting weeks for the old queue to drain.
 */
export async function getSendable(opts: {
  limit: number;
  categoryName?: string;
  city?: string;
}): Promise<Sendable[]> {
  const baseWhere = {
    status: "NEW",
    primaryEmail: { not: null },
    ...(opts.categoryName ? { categoryName: opts.categoryName } : {}),
  };

  // Explicit city filter → honor it exactly (targeted/manual runs).
  if (opts.city) {
    const rows = await prisma.outreachProspect.findMany({
      where: { ...baseWhere, city: { equals: opts.city, mode: "insensitive" } },
      orderBy: { scrapedAt: "asc" },
      take: opts.limit,
    });
    return rows.map(toSendable);
  }

  // Pull a generous pool (target cities first, then the rest), then round-robin
  // by category so recruitment spreads across ALL categories instead of
  // draining whichever was discovered first (med spa). Target-city + recency
  // order is preserved inside each category group.
  const priorityNames = CITIES.map((c) => c.name);
  const poolCap = Math.max(opts.limit * 8, 160);
  const priority = await prisma.outreachProspect.findMany({
    where: { ...baseWhere, city: { in: priorityNames } },
    orderBy: { scrapedAt: "asc" },
    take: poolCap,
  });
  let pool = priority;
  if (pool.length < poolCap) {
    const rest = await prisma.outreachProspect.findMany({
      where: { ...baseWhere, city: { notIn: priorityNames } },
      orderBy: { scrapedAt: "asc" },
      take: poolCap - pool.length,
    });
    pool = [...priority, ...rest];
  }
  return roundRobinByCategory(pool, opts.limit).map(toSendable);
}

// Pick up to `limit` prospects, rotating through categories one at a time so no
// single category dominates. Preserves each category's incoming (pool) order.
function roundRobinByCategory(pool: ProspectRow[], limit: number): ProspectRow[] {
  const groups = new Map<string, ProspectRow[]>();
  for (const r of pool) {
    const k = r.categoryName || "other";
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const queues = Array.from(groups.values());
  const out: ProspectRow[] = [];
  let progress = true;
  while (out.length < limit && progress) {
    progress = false;
    for (const q of queues) {
      if (out.length >= limit) break;
      const next = q.shift();
      if (next) {
        out.push(next);
        progress = true;
      }
    }
  }
  return out;
}

const categoryIdCache = new Map<string, string | null>();
async function categoryIdByName(name: string): Promise<string | null> {
  if (categoryIdCache.has(name)) return categoryIdCache.get(name)!;
  const cat = await prisma.category.findUnique({ where: { name }, select: { id: true } });
  const id = cat?.id ?? null;
  categoryIdCache.set(name, id);
  return id;
}

/**
 * Create the unclaimed draft Provider that the outreach email invites them to
 * claim. No media → invisible in the feed until they claim + add a video.
 * Returns the claim token + slug, or null if the category can't be resolved.
 */
export async function createDraftProvider(p: Sendable): Promise<
  { providerId: string; claimToken: string; slug: string } | null
> {
  const categoryId = await categoryIdByName(p.categoryName);
  if (!categoryId) return null;

  const base = slugify(p.name) || "provider";
  let slug = base;
  for (let i = 2; await prisma.provider.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }

  const claimToken = randomUUID();
  const location = p.address || `${p.city}${p.state ? ", " + p.state : ""}`;

  // AI headline/bio/tags so the pre-built profile doesn't look bare when the
  // owner clicks the claim link. Fail-open — null just means an empty draft.
  const copy = await generateProfileCopy({
    name: p.name,
    categoryName: p.categoryName,
    city: p.city,
  });

  // Build a branded reel from their site: a clean title card (always) plus
  // their framable photos as slides when we find good ones. Rendered + hosted
  // so the profile goes live as a real video the instant they claim — zero
  // effort. Fail-open: any problem → no video, we still try a photo gallery.
  const candidates = p.website ? await scrapePhotos(p.website, 10).catch(() => []) : [];
  let videoUrl: string | null = null;
  let videoPoster: string | null = null;
  let gallery: string[] = [];

  const reel = await renderBrandedReel(
    { name: p.name, category: p.categoryName, city: p.city, slug },
    candidates,
  ).catch(() => null);
  if (reel) {
    gallery = reel.galleryUrls;
    try {
      const v = await uploadMedia(reel.videoPath, "video", "mp4", "video/mp4");
      const poster = await uploadMedia(reel.posterPath, "image", "jpg", "image/jpeg");
      if (v) {
        videoUrl = v;
        videoPoster = poster;
      }
    } finally {
      await rm(reel.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  // If the video didn't upload but we found framable photos, fall back to a
  // photo-only gallery (still a slideshow reel on claim).
  if (!videoUrl && gallery.length === 0 && candidates.length) {
    gallery = candidates.slice(0, 5);
  }

  const provider = await prisma.provider.create({
    data: {
      slug,
      name: p.name,
      categoryId,
      headline: copy?.headline || null,
      bio: copy?.bio || null,
      tags: copy?.tags ?? [],
      city: p.city,
      location,
      phone: p.phone,
      websiteUrl: p.website,
      videoUrl,
      videoPoster,
      gallery,
      pricingUnit: PricingUnit.SESSION,
      // Hidden until claimed: isActive:false keeps the pre-built profile (and
      // its scraped photos) out of the feed and off /p/[slug] entirely. The
      // claim endpoint flips isActive:true, so a gallery-backed profile goes
      // live as a slideshow the moment the owner claims it.
      isApproved: true,
      isActive: false,
      claimed: false,
      claimToken,
      seededFrom: "google places (recruit)",
      rankScore: 1,
    },
    select: { id: true },
  });

  return { providerId: provider.id, claimToken, slug };
}

export async function markSent(
  id: string,
  data: { providerId: string; claimToken: string; resendId: string | null; emailVariant?: string },
): Promise<void> {
  await prisma.outreachProspect.update({
    where: { id },
    data: {
      status: "SENT",
      providerId: data.providerId,
      claimToken: data.claimToken,
      resendId: data.resendId,
      emailVariant: data.emailVariant,
      sentAt: new Date(),
    },
  });
}

// First-touch A/B result: claim rate by email variant. Claims are read live
// from providers.claimed (the true conversion), so this is accurate even if the
// follow-up reconciler hasn't marked rows CONVERTED yet.
export async function abReport(): Promise<void> {
  const rows = await prisma.outreachProspect.findMany({
    where: { emailVariant: { not: null }, providerId: { not: null } },
    select: { emailVariant: true, providerId: true },
  });
  const claimed = await claimedProviderIds(rows.map((r) => r.providerId!));

  const stats: Record<string, { sent: number; claimed: number }> = {};
  for (const r of rows) {
    const v = r.emailVariant!;
    (stats[v] ??= { sent: 0, claimed: 0 }).sent++;
    if (r.providerId && claimed.has(r.providerId)) stats[v].claimed++;
  }

  console.log("\n[A/B] first-touch email — claim conversion by variant:");
  const keys = Object.keys(stats).sort();
  if (!keys.length) {
    console.log("  (no variant-tagged sends yet)");
    return;
  }
  for (const v of keys) {
    const s = stats[v];
    const rate = s.sent ? ((s.claimed / s.sent) * 100).toFixed(1) : "0.0";
    console.log(`  ${v.padEnd(9)} sent ${String(s.sent).padStart(4)}   claimed ${String(s.claimed).padStart(3)}   (${rate}%)`);
  }
}

export async function markFailed(id: string, error: string): Promise<void> {
  await prisma.outreachProspect.update({
    where: { id },
    data: { status: "FAILED", sendError: error.slice(0, 1000), sentAt: new Date() },
  });
}

// ─── Follow-up (one nudge to prospects who got the first email but haven't
// claimed). Uses the status column, so no schema migration: SENT → FOLLOWED_UP.
export type Followupable = Sendable & {
  claimToken: string;
  providerId: string;
  emailVariant: string | null;
};

export async function getFollowupBatch(opts: {
  limit: number;
  minAgeDays: number;
}): Promise<Followupable[]> {
  const cutoff = new Date(Date.now() - opts.minAgeDays * 86_400_000);
  const rows = await prisma.outreachProspect.findMany({
    where: {
      status: "SENT", // exactly SENT — REPLIED/UNSUB/CONVERTED/FOLLOWED_UP excluded
      primaryEmail: { not: null },
      providerId: { not: null },
      claimToken: { not: null },
      sentAt: { lte: cutoff },
    },
    orderBy: { sentAt: "asc" },
    take: opts.limit,
  });
  return rows.map((r) => ({
    ...toSendable(r),
    claimToken: r.claimToken!,
    providerId: r.providerId!,
    emailVariant: r.emailVariant,
  }));
}

/** Which of these draft providers have actually been claimed (so we skip + convert). */
export async function claimedProviderIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.provider.findMany({
    where: { id: { in: ids }, claimed: true },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export async function markFollowedUp(id: string): Promise<void> {
  await prisma.outreachProspect.update({ where: { id }, data: { status: "FOLLOWED_UP" } });
}

export async function markConverted(id: string): Promise<void> {
  await prisma.outreachProspect.update({ where: { id }, data: { status: "CONVERTED" } });
}

export async function summary(): Promise<Record<string, number>> {
  const rows = await prisma.outreachProspect.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
