import type {
  OrgId,
  ReservationId,
  SeatId,
  TicketTypeId,
  UserId,
} from "../shared/ids";
import type { RiskTier } from "./risk";

export type TicketTypeDef = {
  ticketTypeId: TicketTypeId;
  name: string;
  unitAmount: number; // 最小単位
  currency: string;
};

export type SeatDef = {
  seatId: SeatId;
  rowLabel?: string;
  seatNumber?: string;
  ticketTypeId: TicketTypeId;
};

/** Showing 集約のイベント（テーブル設計書 v1.3 §2.7・ドメイン定義書 §3.1）。 */
export type ShowingEvent =
  // ヘッダのみ（draft）。座席表は SeatsImported で投入。
  | {
      type: "ShowingRegistered";
      organizationId: OrgId;
      title: string;
      startsAt: number;
      ticketTypes: TicketTypeDef[];
      totalSeats: number;
      // read model（showings）整合用。venue/salesStart/End は任意・currency は必須。
      venue?: string;
      salesStartAt?: number; // epoch ms
      salesEndAt?: number; // epoch ms
      currency: string;
      // 公平性/不正対策（Phase 09）。任意（旧イベントには無い＝replay で undefined 許容）。
      riskTier?: RiskTier;
      maxSeatsPerUser?: number;
    }
  // 在庫投入（section/block チャンク。envelope 込み 128KB 未満）。
  | { type: "SeatsImported"; section: string; seats: SeatDef[] }
  | { type: "ShowingPublished" } // draft → on_sale
  | { type: "ShowingUnpublished"; reason?: string } // on_sale → draft
  // userId は購入上限の強整合判定/replay 用（FR-15/BR-05）。
  | {
      type: "SeatsHeld";
      reservationId: ReservationId;
      userId: UserId;
      seatIds: SeatId[];
      holdExpiresAt: number;
    }
  // 注: hold 拒否は **イベント化しない**。Showing DO が seat_conflict / limit_exceeded を
  // 例外で返し API は 409、Reservation 側が MarkHoldRejected → ReservationFailed でイベント化する。
  | {
      type: "SeatsBooked";
      reservationId: ReservationId;
      userId: UserId;
      seatIds: SeatId[];
    }
  | {
      type: "SeatsReleased";
      reservationId: ReservationId;
      userId: UserId;
      seatIds: SeatId[];
      cause: "expired" | "cancelled" | "payment_failed";
    }
  | { type: "ShowingSoldOut" }
  | { type: "ShowingClosed"; reason?: string };

export type ShowingEventType = ShowingEvent["type"];
