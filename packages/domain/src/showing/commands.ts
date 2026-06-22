import type { OrgId, ReservationId, SeatId, UserId } from "../shared/ids";
import type { SeatDef, TicketTypeDef } from "./events";
import type { RiskTier } from "./risk";

/** Showing 集約のコマンド（ドメイン定義書 §3.1）。 */
export type ShowingCommand =
  | {
      type: "RegisterShowing";
      organizationId: OrgId;
      title: string;
      startsAt: number;
      ticketTypes: TicketTypeDef[];
      totalSeats: number;
      // read model（showings）整合のための公演ヘッダ。venue/salesStart/End は任意（nullable）、
      // currency は必須（showings.currency NOT NULL・価格固定 FR-38 と整合）。
      venue?: string;
      salesStartAt?: number; // epoch ms。販売開始（BR-04）
      salesEndAt?: number; // epoch ms。販売終了（BR-04）
      currency: string;
      // 公平性/不正対策（Phase 09）。未指定は general・既定上限 4（decide が補完）。
      riskTier?: RiskTier;
      maxSeatsPerUser?: number; // 公演別の購入上限（FR-15/BR-05）
    }
  | { type: "ImportSeats"; section: string; seats: SeatDef[] }
  | { type: "PublishShowing" }
  | { type: "UnpublishShowing"; reason?: string }
  | {
      type: "HoldSeats";
      reservationId: ReservationId;
      userId: UserId;
      seatIds: SeatId[];
      holdExpiresAt: number;
      requestedAt: number; // 実行時刻（epoch ms）。販売期間ガード BR-04 用に DO が Date.now() を注入
      maxSeatsPerUser?: number; // FR-15/BR-05。未指定なら無制限
    }
  | {
      type: "BookSeats";
      reservationId: ReservationId;
      userId: UserId;
      seatIds: SeatId[];
    }
  | {
      type: "ReleaseSeats";
      reservationId: ReservationId;
      userId: UserId;
      seatIds: SeatId[];
      cause: "expired" | "cancelled" | "payment_failed";
    }
  | { type: "CloseShowing"; reason?: string };

export type ShowingCommandType = ShowingCommand["type"];
