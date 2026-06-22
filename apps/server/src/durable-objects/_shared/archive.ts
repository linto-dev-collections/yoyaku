import type { R2Bucket } from "@cloudflare/workers-types";
import {
  archivableFloorSeq,
  type EventStoreDb,
  events,
  KEEP_SNAPSHOT_COUNT,
  snapshots,
} from "@yoyaku/event-store";
import { asc, lte } from "drizzle-orm";
import type { ProjectionMessage } from "../../types";

/** アーカイブ実行結果（cron/管理エンドポイントの集計用）。 */
export type ArchiveResult = {
  /** プルーン床（seq <= floor を対象）。0 = 対象なし。 */
  floorSeq: number;
  /** R2 退避＋プルーンした events 件数。 */
  archived: number;
  /** プルーンした最大 seq（0 = なし）。 */
  prunedUpTo: number;
};

const NO_OP: ArchiveResult = { floorSeq: 0, archived: 0, prunedUpTo: 0 };

/** events 行 → アーカイブ用の素直な JSON（Date は epoch ms に正規化）。 */
function toArchiveRecord(
  r: typeof events.$inferSelect,
): ProjectionMessage & { recordedAt: number } {
  return {
    eventId: r.eventId,
    aggregateType: r.aggregateType,
    aggregateId: r.aggregateId,
    seq: r.seq,
    eventType: r.eventType,
    schemaVersion: r.schemaVersion,
    occurredAt: r.occurredAt.getTime(),
    payload: r.payload,
    metadata: r.metadata,
    recordedAt: r.recordedAt.getTime(),
  };
}

const pad = (seq: number): string => String(seq).padStart(12, "0");

/**
 * DO events の R2 アーカイブ＋プルーン（NFR-14/16・本フェーズの容量対策）。
 *
 * - 床 `floor` = 保持世代の最古 snapshot seq（`archivableFloorSeq`・純粋）。snapshot が未確立（短い集約）
 *   なら 0 ＝ no-op（安全側）。`loadState` は最新 snapshot＋それ以降の events のみ参照するため、
 *   `seq <= floor` の events を削っても**ライブ復元は不変**（全リプレイ/as-of の古い範囲のみ R2 参照になる）。
 * - **必ず R2 退避が永続化してからプルーン**（put 成功後に delete）。put 失敗時は何も削らない。
 * - 冪等: 既にプルーン済みなら対象 0 件で no-op。再実行で同一 key を上書きしても害なし。
 */
export async function archiveAndPrune(
  store: EventStoreDb,
  storage: DurableObjectStorage,
  bucket: R2Bucket,
  aggregateType: ProjectionMessage["aggregateType"],
  aggregateId: string,
): Promise<ArchiveResult> {
  const snapSeqs = store
    .select({ seq: snapshots.seq })
    .from(snapshots)
    .all()
    .map((r) => r.seq);
  const floor = archivableFloorSeq(snapSeqs, KEEP_SNAPSHOT_COUNT);
  if (floor <= 0) return NO_OP;

  const rows = store
    .select()
    .from(events)
    .where(lte(events.seq, floor))
    .orderBy(asc(events.seq))
    .all();
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return { ...NO_OP, floorSeq: floor };

  const fromSeq = first.seq;
  const toSeq = last.seq;
  const ndjson = `${rows.map((r) => JSON.stringify(toArchiveRecord(r))).join("\n")}\n`;
  const key = `events/${aggregateType}/${aggregateId}/${pad(fromSeq)}-${pad(toSeq)}.jsonl`;

  // 1) 先に R2 へ永続退避（失敗すれば throw → プルーンしない）。
  await bucket.put(key, ndjson, {
    httpMetadata: { contentType: "application/x-ndjson" },
  });

  // 2) 退避済み範囲を DO から削除（同期 Tx）。events のみ（outboxes/snapshots は触れない）。
  storage.transactionSync(() => {
    store.delete(events).where(lte(events.seq, floor)).run();
  });

  return { floorSeq: floor, archived: rows.length, prunedUpTo: toSeq };
}
