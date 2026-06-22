import { db } from "@yoyaku/db";
import { aggregateRegistry } from "@yoyaku/db/schema";
import { eq } from "drizzle-orm";
import { resetProjection } from "../queue/reprojection";
import {
  type ResettableProjection,
  streamsForProjections,
  withCascadeResets,
} from "../queue/reprojection-plan";
import type { Bindings, ProjectionMessage } from "../types";

export type ReprojectSummary = {
  projections: ResettableProjection[];
  showingsReplayed: number;
  reservationsReplayed: number;
  eventsEnqueued: number;
};

type EventSourceStub = {
  getEventsSince: (seq: number) => Promise<ProjectionMessage[]>;
};

const sourceStub = (
  env: Bindings,
  type: ProjectionMessage["aggregateType"],
  id: string,
): EventSourceStub => {
  const ns = type === "Showing" ? env.SHOWING : env.RESERVATION;
  return ns.getByName(id) as unknown as EventSourceStub;
};

/**
 * 再投影 runbook（NFR-17・§3）。対象 read model を truncate＋positions リセットし、
 * ソース DO の events を seq 0 から `PROJECTION_QUEUE` へ再投入する。consumer の gap 検知が
 * 順序整合を保ち、idempotent に read model を再構築する（**後追い projection の土台**＝§5）。
 *
 * 手順:
 *  1. FK cascade を考慮してリセット集合を補正（showings → ticket_types/seat_availabilities も）。
 *  2. 再生対象の aggregateId を **aggregate_registry** から列挙（read model とは独立＝truncate や
 *     read model 全損・後追い projection でも完全な ID 集合を得られる。ニワトリ卵の解消・§4.5）。
 *  3. 各投影を reset（truncate + positions 0）。
 *  4. ソース DO の全 events を queue へ再投入（他投影は position が head のため skip＝冪等）。
 *
 * 注: R2 アーカイブ済み（プルーン済み）の古い events は DO に残らないため、その範囲は R2 から
 * 復元する必要がある（本フェーズは未プルーン範囲の再投影＝通常運用を対象。完全復元は §13 runbook）。
 */
export async function reproject(
  env: Bindings,
  requested: readonly ResettableProjection[],
): Promise<ReprojectSummary> {
  const projections = withCascadeResets(requested);
  const streams = streamsForProjections(projections);

  const showingIds = streams.showing
    ? (
        await db
          .select({ id: aggregateRegistry.aggregateId })
          .from(aggregateRegistry)
          .where(eq(aggregateRegistry.aggregateType, "Showing"))
          .all()
      ).map((r) => r.id)
    : [];
  const reservationIds = streams.reservation
    ? (
        await db
          .select({ id: aggregateRegistry.aggregateId })
          .from(aggregateRegistry)
          .where(eq(aggregateRegistry.aggregateType, "Reservation"))
          .all()
      ).map((r) => r.id)
    : [];

  for (const p of projections) await resetProjection(p);

  let eventsEnqueued = 0;
  for (const id of showingIds) {
    eventsEnqueued += await replayAggregate(env, "Showing", id);
  }
  for (const id of reservationIds) {
    eventsEnqueued += await replayAggregate(env, "Reservation", id);
  }

  return {
    projections,
    showingsReplayed: showingIds.length,
    reservationsReplayed: reservationIds.length,
    eventsEnqueued,
  };
}

/** 1 集約の全 events を queue へ再投入し、投入件数を返す。 */
async function replayAggregate(
  env: Bindings,
  type: ProjectionMessage["aggregateType"],
  id: string,
): Promise<number> {
  const missing = await sourceStub(env, type, id).getEventsSince(0);
  for (const ev of missing) {
    await env.PROJECTION_QUEUE.send(ev);
  }
  return missing.length;
}
