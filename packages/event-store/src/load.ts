import { asc, desc, eq, gt } from "drizzle-orm";
import { events, snapshots } from "./schema";
import type { EventStoreDb } from "./store";
import type { SnapshotPart } from "./types";

export type Loaded<State> = { state: State; version: number };

/**
 * 最新 snapshot（MAX(seq) の全 part）を起点に、seq > snapshot.seq のイベントを
 * 順序適用して現在状態を復元する。
 *
 * domain 非依存を保つため `initialState`/`evolve`/`combineSnapshot` は関数注入。
 * `evolve` は payload を `unknown` で受け、呼び出し側（DO）がドメイン型へキャストする。
 * durable-sqlite は同期実行のため本関数も同期。
 */
export function loadState<State>(
  db: EventStoreDb,
  adapter: {
    initialState: () => State;
    evolve: (state: State, payload: unknown) => State;
    combineSnapshot: (parts: SnapshotPart[]) => State | undefined;
  },
): Loaded<State> {
  // 1) 最新 snapshot 世代の seq。
  const latest = db
    .select({ seq: snapshots.seq })
    .from(snapshots)
    .orderBy(desc(snapshots.seq))
    .limit(1)
    .get();
  const snapSeq = latest?.seq ?? 0;

  // 2) その世代の全 part を結合して基底状態を作る（無ければ initialState）。
  const parts =
    snapSeq > 0
      ? db
          .select({ part: snapshots.part, state: snapshots.state })
          .from(snapshots)
          .where(eq(snapshots.seq, snapSeq))
          .all()
      : [];
  const base = adapter.combineSnapshot(parts) ?? adapter.initialState();

  // 3) snapshot 以降のイベントを順序適用。
  const rows = db
    .select({ seq: events.seq, payload: events.payload })
    .from(events)
    .where(gt(events.seq, snapSeq))
    .orderBy(asc(events.seq))
    .all();

  let state = base;
  let version = snapSeq;
  for (const r of rows) {
    state = adapter.evolve(state, r.payload);
    version = r.seq;
  }
  return { state, version };
}
