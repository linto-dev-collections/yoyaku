import { appendSync } from "./append";
import { type Loaded, loadState } from "./load";
import {
  type NewPendingEffect,
  recordPendingEffectSync,
} from "./pending-effects";
import type { EventStoreError, Result } from "./result";
import {
  KEEP_SNAPSHOT_COUNT,
  latestSnapshotSeq,
  shouldSnapshot,
  writeSnapshotSync,
} from "./snapshot";
import type { EventStoreDb } from "./store";
import type {
  AggregateType,
  AppendOk,
  EventMetadata,
  NewEvent,
  SnapshotPart,
} from "./types";

/**
 * 集約ごとのドメイン適合子。event-store を domain 非依存に保つため、
 * 状態復元（initialState/evolve）と snapshot の (脱)シリアライズを DO 側が注入する。
 * payload/snapshot state は unknown で受け渡し、DO がドメイン型へキャストする。
 */
export type AggregateAdapter<State> = {
  initialState: () => State;
  evolve: (state: State, payload: unknown) => State;
  /** State → JSON 安全な snapshot part 群（Map 等を配列化）。 */
  toSnapshotParts: (state: State) => SnapshotPart[];
  /** snapshot part 群 → State（Map 等を復元）。空なら undefined。 */
  fromSnapshotParts: (parts: SnapshotPart[]) => State | undefined;
};

/**
 * append/load/snapshot をまとめた薄い DO 側ヘルパ。1 DO = 1 集約 = 1 ストリーム。
 * outbox 行は append が書き、publish（Queue 送信）は Phase 02。
 */
export class AggregateStore<State> {
  constructor(
    private readonly db: EventStoreDb,
    private readonly storage: DurableObjectStorage,
    private readonly aggregateType: AggregateType,
    private readonly aggregateId: string,
    private readonly adapter: AggregateAdapter<State>,
  ) {}

  /** snapshot + 差分再生で現在状態と version（= head）を得る。 */
  load(): Loaded<State> {
    return loadState(this.db, {
      initialState: this.adapter.initialState,
      evolve: this.adapter.evolve,
      combineSnapshot: this.adapter.fromSnapshotParts,
    });
  }

  /**
   * events（+任意の pending_effects）を 1 トランザクションで原子追記する。
   * 楽観衝突は err（部分書き込みなし）。pending_effects は Saga 効果の再駆動土台。
   *
   * `onCommitted` は追記成功時に**同一トランザクション内**で呼ばれる（コミット前）。冪等キーの
   * `succeeded` 行を events と原子的に書くために使う（中断時に「events 有り・冪等 in_progress 据置」の
   * 不整合を避ける・FR-28/NFR-03）。コールバックが throw すれば追記ごとロールバックする。
   */
  commit(
    expectedVersion: number,
    events: NewEvent[],
    metadata: EventMetadata,
    pendingEffects: NewPendingEffect[] = [],
    onCommitted?: (ok: AppendOk) => void,
  ): Result<AppendOk, EventStoreError> {
    return this.storage.transactionSync(() => {
      const appended = appendSync(this.db, {
        aggregateId: this.aggregateId,
        aggregateType: this.aggregateType,
        expectedVersion,
        events,
        metadata,
      });
      if (appended.type === "err") return appended;
      for (const effect of pendingEffects) {
        recordPendingEffectSync(this.db, effect);
      }
      onCommitted?.(appended.value);
      return appended;
    });
  }

  /**
   * 必要なら snapshot を取得する（best-effort）。head が前回から SNAPSHOT_EVERY 以上
   * 進んでいれば現在状態を part 分割して保存し、古い世代を prune する。
   * part が行上限超過なら書かずに skip（commit は壊さない）。
   */
  maybeSnapshot(head: number, state: State): void {
    const last = latestSnapshotSeq(this.db, this.aggregateId);
    if (!shouldSnapshot(head, last)) return;
    const parts = this.adapter.toSnapshotParts(state);
    this.storage.transactionSync(() =>
      writeSnapshotSync(this.db, {
        aggregateId: this.aggregateId,
        seq: head,
        parts,
        keep: KEEP_SNAPSHOT_COUNT,
      }),
    );
  }
}
