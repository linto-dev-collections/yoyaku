import type { OrgId, ReservationId, SeatId, UserId } from "../shared/ids";
import type { RiskTier } from "./risk";

export type SeatStatus = "Available" | "Held" | "Booked";
export type ShowingLifecycle =
  | "None"
  | "Draft"
  | "OnSale"
  | "Closed"
  | "SoldOut";

export type SeatState = {
  status: SeatStatus;
  heldBy?: ReservationId;
  bookedBy?: ReservationId;
};

/** Showing 集約の状態。events から復元（リプレイ）。 */
export type ShowingState = {
  status: ShowingLifecycle;
  organizationId?: OrgId;
  title?: string;
  startsAt?: number;
  venue?: string;
  /** 販売開始/終了（epoch ms）。販売期間ガード BR-04 の判定に使用。 */
  salesStartAt?: number;
  salesEndAt?: number;
  /** 通貨（公演ヘッダ確定値）。read model 投影・価格固定 FR-38 と整合。 */
  currency?: string;
  totalSeats: number;
  /** 負荷/リスク区分（NFR-15）。未登録は "general"。Turnstile/Waiting Room 必須化の導出に使う。 */
  riskTier: RiskTier;
  /** 公演別の購入上限（FR-15/BR-05）。HoldSeats の上限ガードが参照（未設定は command 値にフォールバック）。 */
  maxSeatsPerUser?: number;
  seats: Map<SeatId, SeatState>;
  /** 購入上限の強整合判定用（FR-15/BR-05）。userId→確保中の席数。 */
  holdsByUser: Map<UserId, number>;
};

export const initialShowingState = (): ShowingState => ({
  status: "None",
  totalSeats: 0,
  riskTier: "general",
  seats: new Map(),
  holdsByUser: new Map(),
});
