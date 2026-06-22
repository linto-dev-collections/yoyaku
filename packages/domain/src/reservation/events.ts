import type { Pricing } from "@yoyaku/shared";
import type { OrgId, SeatId, ShowingId, UserId } from "../shared/ids";

/** Reservation（購入プロセス＝Saga）のイベント（テーブル設計書 v1.3 §2.7・ドメイン §3.2）。 */
export type ReservationEvent =
  | {
      type: "ReservationInitiated";
      userId: UserId;
      showingId: ShowingId;
      organizationId: OrgId;
      seatIds: SeatId[];
      pricing: Pricing; // 価格固定（FR-38/BR-14）
    }
  | { type: "ReservationHeld"; holdExpiresAt: number }
  | { type: "ReservationFailed"; reason: string }
  // PI 作成時に paymentIntentId を即記録（FR-26/BR-11）。status は AwaitingPayment のまま。
  // これにより確保失効が webhook(authorize) より先でも terminate が与信 void 効果を生成できる。
  | { type: "ReservationPaymentPending"; paymentIntentId: string }
  | {
      type: "ReservationAuthorized";
      paymentIntentId: string;
      amount: number;
      applicationFeeAmount: number;
    }
  // capture 着手（Authorized→Capturing）。Stripe capture の前に記録し、この間の hold 失効を抑止する。
  | { type: "ReservationCaptureStarted" }
  // sales_dashboards 投影が自己完結できるよう帰属・金額を内包（#4）。
  | {
      type: "ReservationConfirmed";
      showingId: ShowingId;
      organizationId: OrgId;
      capturedAmount: number;
      applicationFeeAmount: number;
      currency: string;
      confirmedAt: number;
    }
  | { type: "ReservationExpired" }
  | { type: "ReservationPaymentFailed"; cause: string }
  | { type: "ReservationCancelled" };

export type ReservationEventType = ReservationEvent["type"];
