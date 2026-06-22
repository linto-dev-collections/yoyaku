import { db } from "@yoyaku/db";
import { reservations, showings } from "@yoyaku/db/schema";
import type { ArchiveResult } from "../durable-objects/_shared/archive";
import { structuredLog } from "../lib/observability";
import type { Bindings, ProjectionMessage } from "../types";

export type ArchiveSummary = {
  aggregatesScanned: number;
  aggregatesPruned: number;
  eventsArchived: number;
};

type ArchiveStub = { archiveOldEvents: () => Promise<ArchiveResult> };

const archiveStub = (
  env: Bindings,
  type: ProjectionMessage["aggregateType"],
  id: string,
): ArchiveStub => {
  const ns = type === "Showing" ? env.SHOWING : env.RESERVATION;
  return ns.getByName(id) as unknown as ArchiveStub;
};

/**
 * events アーカイブ/プルーンの一括実行（NFR-14/16・cron 日次）。read model から集約 ID を列挙し、
 * 各 DO の `archiveOldEvents`（snapshot 確立済み範囲のみ R2 退避→プルーン・冪等）を呼ぶ。
 * snapshot 未確立の短い集約は no-op（archived=0）なので通常データには影響しない。
 */
export async function runArchive(env: Bindings): Promise<ArchiveSummary> {
  const showingIds = (
    await db.select({ id: showings.showingId }).from(showings).all()
  ).map((r) => r.id);
  const reservationIds = (
    await db.select({ id: reservations.reservationId }).from(reservations).all()
  ).map((r) => r.id);

  const summary: ArchiveSummary = {
    aggregatesScanned: showingIds.length + reservationIds.length,
    aggregatesPruned: 0,
    eventsArchived: 0,
  };

  const run = async (type: ProjectionMessage["aggregateType"], id: string) => {
    try {
      const r = await archiveStub(env, type, id).archiveOldEvents();
      if (r.archived > 0) {
        summary.aggregatesPruned += 1;
        summary.eventsArchived += r.archived;
      }
    } catch (e) {
      console.log(
        structuredLog("warn", "archive_failed", {
          aggregateType: type,
          aggregateId: id,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };

  for (const id of showingIds) await run("Showing", id);
  for (const id of reservationIds) await run("Reservation", id);

  return summary;
}
