import type { Pricing } from "@yoyaku/shared";
import type { OrgId, SeatId, ShowingId, UserId } from "../shared/ids";

/** Reservation のコマンド/トリガー。Showing/Payment との連携結果も取り込む。 */
export type ReservationCommand =
  | {
      type: "StartReservation";
      userId: UserId;
      showingId: ShowingId;
      organizationId: OrgId;
      seatIds: SeatId[];
      pricing: Pricing;
    }
  | { type: "MarkHeld"; holdExpiresAt: number } // ← SeatsHeld 統合
  | { type: "MarkHoldRejected"; reason: string } // hold 拒否(Showing の例外/409)を Reservation 側でイベント化
  // PI 作成直後に paymentIntentId を記録（与信 void 漏れ対策・FR-26/BR-11）。冪等。
  | { type: "AttachPaymentIntent"; paymentIntentId: string }
  | {
      type: "Authorize";
      paymentIntentId: string;
      amount: number;
      applicationFeeAmount: number;
    }
  // capture 着手（Authorized→Capturing・非失効化）。Stripe capture の前に記録する（指摘: capture×失効競合）。
  | { type: "BeginCapture" }
  | {
      type: "Capture";
      capturedAmount: number;
      currency: string;
      capturedAt: number;
    }
  | { type: "Expire" } // alarm（hold 期限）
  | { type: "Cancel" } // 確保中の取消
  | { type: "MarkPaymentFailed"; cause: string };

export type ReservationCommandType = ReservationCommand["type"];
