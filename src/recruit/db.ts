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

  const priorityNames = CITIES.map((c) => c.name);
  const priority = await prisma.outreachProspect.findMany({
    where: { ...baseWhere, city: { in: priorityNames } },
    orderBy: { scrapedAt: "asc" },
    take: opts.limit,
  });
  let rows = priority;
  if (rows.length < opts.limit) {
    const rest = await prisma.outreachProspect.findMany({
      where: { ...baseWhere, city: { notIn: priorityNames } },
      orderBy: { scrapedAt: "asc" },
      take: opts.limit - rows.length,
    });
    rows = [...priority, ...rest];
  }
  return rows.map(toSendable);
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
      pricingUnit: PricingUnit.SESSION,
      // Approved + active but no media → does not appear in the feed. Unclaimed
      // until the real owner claims via claimToken and adds their reel.
      isApproved: true,
      isActive: true,
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
  data: { providerId: string; claimToken: string; resendId: string | null },
): Promise<void> {
  await prisma.outreachProspect.update({
    where: { id },
    data: {
      status: "SENT",
      providerId: data.providerId,
      claimToken: data.claimToken,
      resendId: data.resendId,
      sentAt: new Date(),
    },
  });
}

export async function markFailed(id: string, error: string): Promise<void> {
  await prisma.outreachProspect.update({
    where: { id },
    data: { status: "FAILED", sendError: error.slice(0, 1000), sentAt: new Date() },
  });
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
