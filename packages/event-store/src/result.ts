// イベントストア層の Result/EventStoreError（event-store-adapter-js を移植）。
// 方針: イベントストア層は throw せず Result を返す。ドメイン違反は decide が
// DomainError を throw する別経路（@yoyaku/domain）であり、ここには持ち込まない。

export type Result<T, E> =
  | { readonly type: "ok"; readonly value: T }
  | { readonly type: "err"; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ type: "ok", value });
export const err = <E>(error: E): Result<never, E> => ({ type: "err", error });

/** イベントストア層で起き得る失敗（ドメイン違反は含まない）。 */
export type EventStoreError =
  | {
      type: "optimistic_lock_conflict";
      message: string;
      expected: number;
      actual: number;
    }
  | { type: "idempotency_conflict"; message: string } // 同一 key・異なる request_hash
  | { type: "in_progress"; message: string } // 同一 key が処理中（再試行可）
  | { type: "previously_failed"; message: string; errorCode: string } // 同一 key が過去に失敗
  | {
      type: "serialization";
      operation: "serialize" | "deserialize";
      message: string;
      cause?: unknown;
    }
  | { type: "storage"; message: string; cause?: unknown };

export const EventStoreError = {
  optimisticLock: (expected: number, actual: number): EventStoreError => ({
    type: "optimistic_lock_conflict",
    message: `optimistic lock failed: expected ${expected}, actual ${actual}`,
    expected,
    actual,
  }),
  idempotencyConflict: (
    message = "idempotency key reused with different request",
  ): EventStoreError => ({ type: "idempotency_conflict", message }),
  inProgress: (
    message = "idempotency key is currently in progress",
  ): EventStoreError => ({ type: "in_progress", message }),
  previouslyFailed: (errorCode: string): EventStoreError => ({
    type: "previously_failed",
    message: `command previously failed: ${errorCode}`,
    errorCode,
  }),
  serialization: (
    operation: "serialize" | "deserialize",
    message: string,
    cause?: unknown,
  ): EventStoreError => ({ type: "serialization", operation, message, cause }),
  storage: (message: string, cause?: unknown): EventStoreError => ({
    type: "storage",
    message,
    cause,
  }),
} as const;
