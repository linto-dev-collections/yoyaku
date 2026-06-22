import { DomainError } from "@yoyaku/domain";
import type { EventStoreError } from "@yoyaku/event-store";

/**
 * イベントストア層の Result.err（EventStoreError）を HTTP 用 DomainError へマップする。
 * 楽観衝突・冪等関連は 409、ストレージ/シリアライズは 500。route（Phase 04）が status を返す。
 */
export function eventStoreErrorToHttp(error: EventStoreError): DomainError {
  switch (error.type) {
    case "optimistic_lock_conflict":
      return new DomainError("conflict", 409, error.message);
    case "idempotency_conflict":
      return new DomainError("idempotency_conflict", 409, error.message);
    case "in_progress":
      return new DomainError("in_progress", 409, error.message);
    case "previously_failed":
      return new DomainError(error.errorCode, 409, error.message);
    case "serialization":
    case "storage":
      return new DomainError("internal", 500, error.message);
    default:
      error satisfies never;
      return new DomainError("internal", 500, "unknown event store error");
  }
}
