import type { Pricing } from "@yoyaku/shared";
import type { OrgId, SeatId, ShowingId, UserId } from "../shared/ids";

export type ReservationStatus =
  | "None"
  | "Initiated"
  | "AwaitingPayment"
  | "Authorized"
  // capture 着手済み（Stripe capture 進行中）。失効対象外＝この間に hold 失効しても席を解放しない
  // （capture×失効競合で「入金あり・席なし」になるのを防ぐ）。Capture 成功で Confirmed へ。
  | "Capturing"
  | "Confirmed"
  | "Cancelled"
  | "Expired"
  | "PaymentFailed"
  | "Failed";

export type ReservationState = {
  status: ReservationStatus;
  userId?: UserId;
  showingId?: ShowingId;
  organizationId?: OrgId;
  seatIds: SeatId[];
  pricing?: Pricing;
  paymentIntentId?: string;
  holdExpiresAt?: number;
};

export const initialReservationState = (): ReservationState => ({
  status: "None",
  seatIds: [],
});

/**
 * hold 失効の対象になりうる状態か（BR-10）。確保済みで未確定＝AwaitingPayment/Authorized。
 * 確定/取消/失効/失敗は対象外（タイマー駆動の Expire を no-op にする）。alarm ハンドラが参照。
 * **Capturing は意図的に除外**: capture 着手後に hold 失効で席を解放すると「入金あり・席なし」に
 * なるため、capture 進行中は失効させない（capture 完了 or 補償で収束させる）。
 */
export const isExpirable = (status: ReservationStatus): boolean =>
  status === "AwaitingPayment" || status === "Authorized";
