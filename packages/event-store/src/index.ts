export { type AggregateAdapter, AggregateStore } from "./aggregate-store";
// --- Phase 01: イベントストア・コア API ---
export { appendSync } from "./append";
// --- Phase 10: events アーカイブ可否（純粋・NFR-14/16） ---
export { archivableFloorSeq } from "./archive";
export {
  canonicalize,
  computeRequestHash,
  type IdempotencyContext,
  withIdempotency,
} from "./idempotency";
export { type Loaded, loadState } from "./load";
export {
  bumpEffectAttemptSync,
  type EffectKind,
  listPendingEffects,
  markEffectDoneSync,
  type NewPendingEffect,
  type PendingEffectRow,
  recordPendingEffectSync,
} from "./pending-effects";
export {
  type EventStoreError,
  err,
  ok,
  type Result,
} from "./result";
export * as eventStoreSchema from "./schema";
export {
  events,
  idempotencyKeys,
  outboxes,
  pendingEffects,
  snapshots,
  streams,
} from "./schema";
export {
  KEEP_SNAPSHOT_COUNT,
  latestSnapshotSeq,
  MAX_SNAPSHOT_PART_BYTES,
  pickSnapshotSeqsToPrune,
  SNAPSHOT_EVERY,
  shouldSnapshot,
  snapshotPartByteSize,
  writeSnapshotSync,
} from "./snapshot";
export {
  createEventStoreDb,
  type EventStoreDb,
  migrateEventStore,
} from "./store";
export type {
  AggregateType,
  AppendInput,
  AppendOk,
  EventMetadata,
  NewEvent,
  SnapshotPart,
} from "./types";
