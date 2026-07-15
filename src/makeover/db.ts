/**
 * Queue state for the makeover pipeline. Reuses the recruit engine's Prisma
 * client (one shared PeekScout Postgres). Rows are created PENDING by the app's
 * POST /api/makeover; this worker claims them PROCESSING, then marks DONE/FAILED.
 */
import { prisma } from "../recruit/db";

export type MakeoverRow = {
  id: string;
  sourceUrl: string;
  name: string;
  service: string;
  email: string;
};

/**
 * Atomically claim up to `limit` PENDING rows: flip them to PROCESSING so a
 * second runner won't pick the same ones. Single-worker-safe; the id+status
 * guard on the update also covers the rare double-runner case.
 */
export async function claimPending(limit: number): Promise<MakeoverRow[]> {
  const rows = await prisma.makeoverRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, sourceUrl: true, name: true, service: true, email: true },
  });
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  await prisma.makeoverRequest.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  return rows;
}

export async function markDone(
  id: string,
  data: { resultUrl: string; coverUrl: string | null; hook: string; resendId: string | null },
): Promise<void> {
  await prisma.makeoverRequest.update({
    where: { id },
    data: {
      status: "DONE",
      resultUrl: data.resultUrl,
      coverUrl: data.coverUrl,
      hook: data.hook,
      resendId: data.resendId,
      processedAt: new Date(),
    },
  });
}

export async function markFailed(id: string, error: string): Promise<void> {
  await prisma.makeoverRequest.update({
    where: { id },
    data: { status: "FAILED", error: error.slice(0, 1000), processedAt: new Date() },
  });
}

export async function summary(): Promise<Record<string, number>> {
  const rows = await prisma.makeoverRequest.groupBy({ by: ["status"], _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}
