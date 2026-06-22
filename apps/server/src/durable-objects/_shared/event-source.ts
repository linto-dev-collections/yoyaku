import { type EventStoreDb, events } from "@yoyaku/event-store";
import { asc, gt } from "drizzle-orm";
import type { ProjectionMessage } from "../../types";

/**
 * DO（正本）の events を seq > given で昇順に ProjectionMessage 形で返す。
 * gap の能動 backfill（consumer §2.3）と再投影（§4）で共用する DO RPC の実体。
 */
export function readEventsSince(
  store: EventStoreDb,
  seq: number,
): ProjectionMessage[] {
  const rows = store
    .select()
    .from(events)
    .where(gt(events.seq, seq))
    .orderBy(asc(events.seq))
    .all();
  return rows.map((r) => ({
    eventId: r.eventId,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    seq: r.seq,
    eventType: r.eventType,
    schemaVersion: r.schemaVersion,
    occurredAt: r.occurredAt.getTime(),
    payload: r.payload,
    metadata: r.metadata,
  }));
}
