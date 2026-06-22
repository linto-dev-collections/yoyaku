import type { Message, MessageBatch } from "@cloudflare/workers-types";
import { db } from "@yoyaku/db";
import { projectionDeadLetters } from "@yoyaku/db/schema";
import { sql } from "drizzle-orm";
import { ulid } from "ulid";
import { structuredLog } from "../lib/observability";
import type { ProjectionMessage } from "../types";

/**
 * 投影 DLQ consumer（指摘2・NFR-09）。projection-queue で maxRetries を超過した毒メッセージは
 * Cloudflare により DLQ（projectionDlq）へ退避される。この consumer はそれを `projection_dead_letters`
 * （D1）へ**永続記録**して可観測化する（無 consumer の DLQ は 4 日で自動削除されサイレントに失われるため）。
 * 記録のみで再投影はしない（運用是正は admin の reproject 等・別経路）。
 */
export async function handleDeadLetterBatch(
  batch: MessageBatch<ProjectionMessage>,
): Promise<void> {
  for (const msg of batch.messages) {
    await recordDeadLetter(msg);
  }
}

async function recordDeadLetter(
  msg: Message<ProjectionMessage>,
): Promise<void> {
  const b = msg.body;
  // envelope が壊れていて eventId が無い場合でも記録を落とさない（合成 ID で残す）。
  const eventId =
    typeof b?.eventId === "string" && b.eventId.length > 0
      ? b.eventId
      : `malformed:${ulid()}`;
  try {
    await db
      .insert(projectionDeadLetters)
      .values({
        eventId,
        aggregateType: b?.aggregateType ?? "unknown",
        aggregateId: b?.aggregateId ?? "unknown",
        seq: typeof b?.seq === "number" ? b.seq : 0,
        eventType: b?.eventType ?? "unknown",
        payload: b?.payload ?? null,
      })
      // 同一イベントの再 dead-letter は attempts を加算（冪等・観測）。
      .onConflictDoUpdate({
        target: projectionDeadLetters.eventId,
        set: {
          attempts: sql`${projectionDeadLetters.attempts} + 1`,
          lastSeenAt: new Date(),
        },
      });
    console.log(
      structuredLog("error", "projection_dead_letter", {
        eventId,
        aggregateType: b?.aggregateType,
        aggregateId: b?.aggregateId,
        seq: b?.seq,
        eventType: b?.eventType,
      }),
    );
    msg.ack();
  } catch (e) {
    // 記録自体の失敗（D1 一時障害等）→ retry（DLQ consumer 自身の maxRetries 内で再試行）。
    console.log(
      structuredLog("error", "projection_dead_letter_record_failed", {
        eventId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    msg.retry();
  }
}
