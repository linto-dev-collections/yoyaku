import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Result } from "./result";
import { EventStoreError as E, type EventStoreError, err, ok } from "./result";
import { events, outboxes, streams } from "./schema";
import type { EventStoreDb } from "./store";
import type { AppendInput, AppendOk } from "./types";

/**
 * 楽観ロック付き原子追記。events・outboxes・streams を一括で書く。
 *
 * **原子性**: 呼び出し側が `ctx.storage.transactionSync(() => appendSync(db, input))`
 * で包む（drizzle/durable-sqlite の run/insert は同期実行で、その storage トランザクション
 * に参加する）。失敗時は transactionSync がロールバックする。`events.seq` の PK 制約が
 * 万一の二重採番を物理的に拒否する（FR-12 の最後の砦）。
 *
 * 楽観衝突は writes 前に検出して `err` を返す（部分書き込みは起きない）。
 */
export function appendSync(
  db: EventStoreDb,
  input: AppendInput,
): Result<AppendOk, EventStoreError> {
  // 1) head 照合（楽観ロック）。streams 1 行（この DO の集約）。
  const headRow = db
    .select({ version: streams.version })
    .from(streams)
    .where(eq(streams.aggregateId, input.aggregateId))
    .get();
  const head = headRow?.version ?? 0;
  if (head !== input.expectedVersion) {
    return err(E.optimisticLock(input.expectedVersion, head));
  }

  // 2) seq 採番 = head + i + 1、eventId=ULID、envelope を events と outboxes へ二重書き。
  const eventIds: string[] = [];
  let seq = head;
  for (const e of input.events) {
    seq += 1;
    const eventId = ulid();
    eventIds.push(eventId);
    const occurredAt = new Date(e.occurredAt);
    const schemaVersion = e.schemaVersion ?? 1;
    db.insert(events)
      .values({
        seq,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        eventId,
        eventType: e.eventType,
        payload: e.payload,
        metadata: input.metadata,
        schemaVersion,
        occurredAt,
      })
      .run(); // events.seq PK が二重採番を物理拒否
    db.insert(outboxes)
      .values({
        seq,
        eventId,
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        eventType: e.eventType,
        schemaVersion,
        payload: e.payload,
        metadata: input.metadata,
        occurredAt,
        status: "pending",
      })
      .run(); // 行 = Queue メッセージ（envelope 全体）
  }

  // 3) streams head 前進（upsert）。
  db.insert(streams)
    .values({
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      version: seq,
    })
    .onConflictDoUpdate({
      target: streams.aggregateId,
      set: { version: seq },
    })
    .run();

  return ok({ fromSeq: head + 1, toSeq: seq, eventIds });
}
