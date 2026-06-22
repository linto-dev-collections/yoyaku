import type { ProjectionMessage } from "../../types";

/** outbox 行（envelope 全体）の Queue 送信に必要な部分。 */
export type OutboxEnvelopeRow = {
  seq: number;
  eventId: string;
  aggregateId: string;
  aggregateType: ProjectionMessage["aggregateType"];
  eventType: string;
  schemaVersion: number;
  payload: unknown;
  metadata: ProjectionMessage["metadata"];
  occurredAt: Date;
};

/**
 * outbox 行を Queue メッセージ（ProjectionMessage）へ写像する（純粋）。
 * occurredAt は DB 上 timestamp_ms（Date）なので epoch ms（number）へ変換する。
 * db を import しないため vitest（node）で単体検証できる。
 */
export function toEnvelope(row: OutboxEnvelopeRow): ProjectionMessage {
  return {
    eventId: row.eventId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    seq: row.seq,
    eventType: row.eventType,
    schemaVersion: row.schemaVersion,
    occurredAt: row.occurredAt.getTime(),
    payload: row.payload,
    metadata: row.metadata,
  };
}
