import { z } from "zod";

/**
 * Queue メッセージ envelope の構造検証（毒メッセージの早期検知・指摘2）。純粋（db 非依存＝vitest 対象）。
 * payload は projection 側が eventType ごとに型解釈するためここでは unknown（中身は検証しない）。
 * 構造不正（トップレベル欠落・型不一致）は自己修復しないため、consumer は retry→DLQ で隔離・記録する。
 */
export const projectionEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  aggregateType: z.enum(["Showing", "Reservation"]),
  aggregateId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  eventType: z.string().min(1),
  schemaVersion: z.number().int(),
  occurredAt: z.number(),
  payload: z.unknown(),
  metadata: z.object({
    correlationId: z.string(),
    causationId: z.string().optional(),
    actor: z.string(),
  }),
});
