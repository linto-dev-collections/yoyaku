import type { Queue } from "@cloudflare/workers-types";
import { type EventStoreDb, outboxes } from "@yoyaku/event-store";
import { asc, count, eq } from "drizzle-orm";
import type { ProjectionMessage } from "../../types";
import { OUTBOX_BACKSTOP_MS } from "./alarm";
import { toEnvelope } from "./envelope";

/**
 * pending な outbox を seq 昇順に Queue へ送る。送信できた行は published に更新。
 * 送信失敗（throw）はその行以降を pending 据え置き＝at-least-once（consumer が冪等吸収）。
 * durable-sqlite の select/update は同期実行、queue.send は非同期。
 */
export async function publishOutbox(
  store: EventStoreDb,
  queue: Queue<ProjectionMessage>,
): Promise<{ remaining: number }> {
  const pending = store
    .select()
    .from(outboxes)
    .where(eq(outboxes.status, "pending"))
    .orderBy(asc(outboxes.seq))
    .all();
  for (const row of pending) {
    await queue.send(toEnvelope(row));
    store
      .update(outboxes)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(outboxes.seq, row.seq))
      .run();
  }
  const remaining =
    store
      .select({ n: count() })
      .from(outboxes)
      .where(eq(outboxes.status, "pending"))
      .get()?.n ?? 0;
  return { remaining };
}

/** 未送信（pending）outbox 行数（alarm 再 arm の backstop 要否判定に使う・同期）。 */
export function countPendingOutbox(store: EventStoreDb): number {
  return (
    store
      .select({ n: count() })
      .from(outboxes)
      .where(eq(outboxes.status, "pending"))
      .get()?.n ?? 0
  );
}

/**
 * インライン publish ＋ alarm backstop。送信に失敗/積み残しがあれば backstop alarm を
 * 「より早い時刻があれば」設定する（既存の hold 失効 alarm を後ろ倒しで上書きしない）。
 */
export async function flushOutboxWithBackstop(
  store: EventStoreDb,
  queue: Queue<ProjectionMessage>,
  storage: DurableObjectStorage,
  now: number,
): Promise<void> {
  let remaining: number;
  try {
    remaining = (await publishOutbox(store, queue)).remaining;
  } catch {
    remaining = 1; // 送信失敗 → pending ありとみなす
  }
  if (remaining > 0) {
    const next = now + OUTBOX_BACKSTOP_MS;
    const current = await storage.getAlarm();
    if (current === null || next < current) {
      await storage.setAlarm(next);
    }
  }
}
