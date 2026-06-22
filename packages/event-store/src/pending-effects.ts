import { eq } from "drizzle-orm";
import { pendingEffects } from "./schema";
import type { EventStoreDb } from "./store";

/** Reservation Saga が起こす効果の種類。 */
export type EffectKind =
  | "hold"
  | "book"
  | "release"
  | "authorize"
  | "capture"
  | "void";

export type NewPendingEffect = {
  effectId: string;
  kind: EffectKind;
  payload: unknown;
};

export type PendingEffectRow = {
  effectId: string;
  kind: EffectKind;
  payload: unknown;
  attempts: number;
};

/**
 * 効果を起こす前に pending 記録する（events 追記と同一 Tx で呼ぶ）。
 * 既存 effectId は no-op（再駆動時の二重記録を避ける）。
 */
export function recordPendingEffectSync(
  db: EventStoreDb,
  effect: NewPendingEffect,
): void {
  db.insert(pendingEffects)
    .values({
      effectId: effect.effectId,
      kind: effect.kind,
      payload: effect.payload,
      status: "pending",
    })
    .onConflictDoNothing({ target: pendingEffects.effectId })
    .run();
}

/** 効果完了で done 更新（効果の RPC/Stripe 成功後）。 */
export function markEffectDoneSync(db: EventStoreDb, effectId: string): void {
  db.update(pendingEffects)
    .set({ status: "done" })
    .where(eq(pendingEffects.effectId, effectId))
    .run();
}

/** 再駆動時に attempts を加算（観測・無限ループ検知の土台）。 */
export function bumpEffectAttemptSync(
  db: EventStoreDb,
  effectId: string,
): void {
  const row = db
    .select({ attempts: pendingEffects.attempts })
    .from(pendingEffects)
    .where(eq(pendingEffects.effectId, effectId))
    .get();
  db.update(pendingEffects)
    .set({ attempts: (row?.attempts ?? 0) + 1 })
    .where(eq(pendingEffects.effectId, effectId))
    .run();
}

/** 未 done の効果を列挙（DO 起動/alarm で冪等再駆動する対象）。 */
export function listPendingEffects(db: EventStoreDb): PendingEffectRow[] {
  return db
    .select({
      effectId: pendingEffects.effectId,
      kind: pendingEffects.kind,
      payload: pendingEffects.payload,
      attempts: pendingEffects.attempts,
    })
    .from(pendingEffects)
    .where(eq(pendingEffects.status, "pending"))
    .all();
}
