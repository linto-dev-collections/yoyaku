import { eq } from "drizzle-orm";
import type { Result } from "./result";
import { EventStoreError as E, type EventStoreError, err, ok } from "./result";
import { idempotencyKeys } from "./schema";
import type { EventStoreDb } from "./store";

/**
 * リクエスト本文を安定（キー昇順・undefined 除外）に文字列化する（純粋）。
 * request_hash の決定性に必要。
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/** 正規化本文の SHA-256 16 進文字列（Workers/Node 互換の crypto.subtle）。 */
export async function computeRequestHash(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type IdempotencyContext = {
  key: string;
  commandType: string;
  actor: string;
  /** computeRequestHash(正規化本文) の結果。route 側（Phase 04）で算出して渡す。 */
  requestHash: string;
  /** 既定: 決済系は >=24h、その他 1h。 */
  ttlMs: number;
  /** 現在時刻（epoch ms）。expiresAt 算出に注入（純粋性のため DO が Date.now() を渡す）。 */
  now: number;
};

/** thrown error から `code`（DomainError.code 等）を取り出す（domain 非依存・duck typing）。 */
function errorCodeOf(e: unknown): string {
  if (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string"
  ) {
    return (e as { code: string }).code;
  }
  return "internal";
}

/**
 * コマンドを「少なくとも1回配信／クライアント再試行下でも一度だけ」適用する（**同期**）。
 * - succeeded かつ hash 一致 → 保存応答を返す（副作用なし）
 * - hash 不一致 → idempotency_conflict（誤用/横取り）
 * - in_progress（旧データ）→ in_progress（呼び出し側で 409/短時間リトライ）
 * - failed → previously_failed（errorCode 付き・同一失敗を再現）
 * - 無し → run() を実行。run は append 成功時に **同一トランザクション内**で `recordSuccess(value)` を
 *   呼び、events と `succeeded` 行を原子的に書く（NFR-03・FR-28）。append しない no-op の場合は
 *   フォールバックで succeeded を書く。throw（DomainError 等）は failed を記録し元の error を再 throw。
 *
 * **原子性**: `succeeded` の確定は events と同一 `transactionSync`（commit の onCommitted）で行うため、
 * 「events 永続化済みだが冪等行は未確定」という中断不整合が起きない。DO は単一ライターのため
 * in_progress 中間状態は不要（並行要求は input gate で直列化される）。
 * 本関数は `await` を挟まない（同期）＝DO の暗黙トランザクション境界をまたがない。
 */
export function withIdempotency<T extends { fromSeq: number; toSeq: number }>(
  db: EventStoreDb,
  ctx: IdempotencyContext,
  run: (recordSuccess: (value: T) => void) => T,
): Result<T, EventStoreError> {
  const existing = db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, ctx.key))
    .get();

  if (existing) {
    if (existing.requestHash !== ctx.requestHash) {
      return err(E.idempotencyConflict());
    }
    if (existing.status === "succeeded") {
      return ok(existing.responseJson as T);
    }
    if (existing.status === "failed") {
      return err(E.previouslyFailed(existing.errorCode ?? "internal"));
    }
    return err(E.inProgress());
  }

  let recorded = false;
  const recordSuccess = (value: T): void => {
    db.insert(idempotencyKeys)
      .values({
        key: ctx.key,
        commandType: ctx.commandType,
        actor: ctx.actor,
        requestHash: ctx.requestHash,
        status: "succeeded",
        firstSeq: value.fromSeq,
        lastSeq: value.toSeq,
        responseJson: value,
        expiresAt: new Date(ctx.now + ctx.ttlMs),
      })
      .onConflictDoUpdate({
        target: idempotencyKeys.key,
        set: {
          status: "succeeded",
          firstSeq: value.fromSeq,
          lastSeq: value.toSeq,
          responseJson: value,
        },
      })
      .run();
    recorded = true;
  };

  try {
    const value = run(recordSuccess);
    // no-op（events を追記しなかった）経路は recordSuccess 未呼び出し → フォールバック記録。
    // 追記済みなら recordSuccess は commit の同一 Tx 内で既に書かれている。
    if (!recorded) recordSuccess(value);
    return ok(value);
  } catch (e) {
    // recorded=true ＝ append と succeeded 行は既に原子的にコミット済み（throw は snapshot 等の
    // 後処理由来）。コマンドは成功しているので failed で上書きせず、そのまま再 throw（再試行は
    // lookup で succeeded 応答を返す）。
    if (recorded) throw e;
    // run() が throw → append Tx はロールバック（events も succeeded 行も無し）。failed を別途記録。
    db.insert(idempotencyKeys)
      .values({
        key: ctx.key,
        commandType: ctx.commandType,
        actor: ctx.actor,
        requestHash: ctx.requestHash,
        status: "failed",
        errorCode: errorCodeOf(e),
        expiresAt: new Date(ctx.now + ctx.ttlMs),
      })
      .onConflictDoUpdate({
        target: idempotencyKeys.key,
        set: { status: "failed", errorCode: errorCodeOf(e) },
      })
      .run();
    throw e; // DomainError は route が HTTP へマップ（domain 経路）
  }
}
