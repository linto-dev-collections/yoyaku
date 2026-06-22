import { z } from "zod";

/**
 * 業務タイムゾーン（JPY・日本語運用）。**時刻の保存・比較は一貫して epoch ms（UTC・絶対時刻）**で行い、
 * このTZは「日次集計の日境界」と「表示/入力変換」にのみ使う（サーバは瞬間を保持し、整形はしない）。
 *
 * 規約:
 * - 保存/比較: epoch ms（UTC）。本TZに依存しない（DB は `unixepoch`＝UTC、ドメインは数値比較）。
 * - 日次集計の日境界（Phase 07）: 本TZ。Asia/Tokyo は DST 無し＝UTC+9 固定。
 *   SQL 集計では `strftime('%Y-%m-%d', ts/1000, 'unixepoch', '+9 hours')` と等価。
 * - 表示/入力変換（Phase 08・Web）: 瞬間 ⇄ JST 壁時計の変換はクライアント責務。
 * - API レスポンスの時刻は **epoch ms（数値）** で統一する。
 */
export const BUSINESS_TIMEZONE = "Asia/Tokyo";

/**
 * 業務TZでの暦日キー `"YYYY-MM-DD"`（日次集計のバケット・表示キー。DST 安全）。
 * 引数は epoch ms。保存値は変えず、集計/表示の境界算出にのみ使う。
 */
export const businessDayKey = (
  epochMs: number,
  timeZone: string = BUSINESS_TIMEZONE,
): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(epochMs);

/** 通貨は ISO 4217、金額は最小単位（JPY=円, USD=セント）の整数で扱う。 */
export const currencySchema = z.string().length(3);
export const minorAmountSchema = z.number().int().nonnegative();

/** 固定価格（確保時に確定し以後不変。要件 FR-38/BR-14）。 */
export const pricingSchema = z.object({
  quantity: z.number().int().positive(),
  subtotalAmount: minorAmountSchema,
  applicationFeeAmount: minorAmountSchema,
  totalAmount: minorAmountSchema,
  currency: currencySchema,
});
export type Pricing = z.infer<typeof pricingSchema>;

/** イベント/コマンドの共通メタデータ（要件 FR-22/28）。 */
export const metadataSchema = z.object({
  correlationId: z.string(),
  causationId: z.string().optional(),
  actor: z.string(),
});
export type Metadata = z.infer<typeof metadataSchema>;

export const RESERVATION_STATUSES = [
  "initiated",
  "awaiting_payment",
  "authorized",
  "confirmed",
  "cancelled",
  "expired",
  "payment_failed",
  "failed",
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const SHOWING_STATUSES = [
  "draft",
  "on_sale",
  "closed",
  "sold_out",
] as const;
export type ShowingStatus = (typeof SHOWING_STATUSES)[number];

export const SEAT_STATUSES = ["available", "held", "booked"] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];
