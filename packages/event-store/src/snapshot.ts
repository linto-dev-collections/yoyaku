import { eq, inArray } from "drizzle-orm";
import type { Result } from "./result";
import { EventStoreError as E, type EventStoreError, err, ok } from "./result";
import { snapshots } from "./schema";
import type { EventStoreDb } from "./store";
import type { SnapshotPart } from "./types";

/** snapshot 取得間隔（head - lastSnapshotSeq がこの値以上で取得）。 */
export const SNAPSHOT_EVERY = 100;
/** 保持する snapshot 世代数（rotating-buffer retention）。 */
export const KEEP_SNAPSHOT_COUNT = 5;
/** 1 part（=1 行の state 値）の上限。DO の 2MB 行上限に対し安全側に倒す。 */
export const MAX_SNAPSHOT_PART_BYTES = 1_900_000;

/** snapshot を取得すべきか（純粋）。 */
export function shouldSnapshot(
  head: number,
  lastSnapshotSeq: number,
  every: number = SNAPSHOT_EVERY,
): boolean {
  return head - lastSnapshotSeq >= every;
}

/**
 * 保持世代を超えた古い snapshot seq を選ぶ（純粋）。
 * 最新 `keep` 世代を残し、それより古い seq（の全 part）を prune 対象にする。
 */
export function pickSnapshotSeqsToPrune(
  seqs: number[],
  keep: number,
): number[] {
  const distinctDesc = [...new Set(seqs)].sort((a, b) => b - a);
  return distinctDesc.slice(Math.max(0, keep));
}

/** part の state JSON が行上限内かを判定（純粋）。 */
export function snapshotPartByteSize(state: unknown): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

/**
 * snapshot を書き込み、古い世代を prune する。best-effort（呼び出し側は err を握り潰し可）。
 * part が上限超過なら何も書かず err を返す（commit は壊さない・§10 で section 分割/R2 退避）。
 * 原子性が要るなら呼び出し側で transactionSync に包む。
 */
export function writeSnapshotSync(
  db: EventStoreDb,
  params: {
    aggregateId: string;
    seq: number;
    parts: SnapshotPart[];
    keep?: number;
  },
): Result<{ seq: number; parts: number }, EventStoreError> {
  for (const p of params.parts) {
    const size = snapshotPartByteSize(p.state);
    if (size > MAX_SNAPSHOT_PART_BYTES) {
      return err(
        E.storage(`snapshot part "${p.part}" exceeds row limit: ${size} bytes`),
      );
    }
  }

  for (const p of params.parts) {
    db.insert(snapshots)
      .values({
        seq: params.seq,
        part: p.part,
        aggregateId: params.aggregateId,
        state: p.state,
      })
      .onConflictDoUpdate({
        target: [snapshots.seq, snapshots.part],
        set: { state: p.state },
      })
      .run();
  }

  const allSeqs = db
    .select({ seq: snapshots.seq })
    .from(snapshots)
    .all()
    .map((r) => r.seq);
  const toPrune = pickSnapshotSeqsToPrune(
    allSeqs,
    params.keep ?? KEEP_SNAPSHOT_COUNT,
  );
  if (toPrune.length > 0) {
    db.delete(snapshots).where(inArray(snapshots.seq, toPrune)).run();
  }

  return ok({ seq: params.seq, parts: params.parts.length });
}

/** 最新 snapshot の seq を読む（無ければ 0）。shouldSnapshot 判定の lastSnapshotSeq に使う。 */
export function latestSnapshotSeq(
  db: EventStoreDb,
  aggregateId: string,
): number {
  const rows = db
    .select({ seq: snapshots.seq })
    .from(snapshots)
    .where(eq(snapshots.aggregateId, aggregateId))
    .all();
  return rows.length > 0 ? Math.max(...rows.map((r) => r.seq)) : 0;
}
