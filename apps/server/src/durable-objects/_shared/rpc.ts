import type { ShowingCommand } from "@yoyaku/domain";
import type {
  AppendOk,
  EventMetadata,
  IdempotencyContext,
} from "@yoyaku/event-store";
import type { Pricing } from "@yoyaku/shared";
import type { ProjectionMessage } from "../../types";
import type { ArchiveResult } from "./archive";

export type { ArchiveResult } from "./archive";

/**
 * DO 間 RPC の DTO（structured-clone 可能な平易オブジェクト）。
 * DomainError はストリームを越えないため `{ ok:false, code, httpStatus, message }` の Result 形で運ぶ。
 * route が ok:false を `throw new DomainError(code, httpStatus, message)` に戻し app.ts が HTTP 化（§5）。
 */
export type RpcErr = {
  ok: false;
  code: string;
  httpStatus: number;
  message?: string;
};

// --- IntakeDO -------------------------------------------------------------
export type AllocateOk = { ok: true; canonicalId: string; isNew: boolean };
export type AllocateResult = AllocateOk | RpcErr;

export type IntakeStub = {
  allocate: (
    commandType: string,
    requestHash: string,
  ) => Promise<AllocateResult>;
};

// --- ShowingDO ------------------------------------------------------------
export type HoldInput = {
  reservationId: string;
  userId: string;
  seatIds: string[];
  requestedAt: number;
  maxSeatsPerUser?: number;
};
export type HoldOk = { ok: true; holdExpiresAt: number };
export type HoldResult = HoldOk | RpcErr;

export type ShowingInfo = {
  status: "None" | "Draft" | "OnSale" | "Closed" | "SoldOut";
  organizationId: string | null;
  // 公平性/不正対策（Phase 09）。Turnstile 必須判定・購入上限ヒントの正本（read model ラグ回避）。
  riskTier: "general" | "popular" | "high_risk";
  maxSeatsPerUser: number | null;
};

/**
 * as-of 状態ビュー（FR-23/24・§5）。`occurred_at <= asOf` のイベントを再生した時点の座席状態を集計。
 * 「販売開始 N 分後の残席」等の分析・運用照会（Phase 10 の管理エンドポイントと統合）に使う。
 */
export type ShowingAsOfView = {
  asOf: number;
  status: ShowingInfo["status"];
  totalSeats: number;
  availableSeats: number;
  heldSeats: number;
  bookedSeats: number;
};

export type ExecuteCommandOk = { ok: true; value: AppendOk };
export type ExecuteCommandResult = ExecuteCommandOk | RpcErr;

/** 補償の席解放（hold 失効/取消）。cause は監査・将来の与信 void 連携用。 */
export type ReleaseCause = "expired" | "cancelled" | "payment_failed";
export type ReleaseInput = {
  reservationId: string;
  userId: string;
  seatIds: string[];
  cause: ReleaseCause;
};
export type ReleaseResult = { ok: true } | RpcErr;

/** 確定の席確保（capture 成功後の `captured⇒booked`）。当該 reservationId が Held 中の席のみ Booked。 */
export type BookInput = {
  reservationId: string;
  userId: string;
  seatIds: string[];
};
export type BookResult = { ok: true } | RpcErr;

export type ShowingStub = {
  execute: (
    command: ShowingCommand,
    meta: EventMetadata,
    idem?: IdempotencyContext,
  ) => Promise<AppendOk>;
  executeCommand: (
    command: ShowingCommand,
    meta: EventMetadata,
    idem?: IdempotencyContext,
    aggregateId?: string,
  ) => Promise<ExecuteCommandResult>;
  hold: (input: HoldInput, meta: EventMetadata) => Promise<HoldResult>;
  book: (input: BookInput, meta: EventMetadata) => Promise<BookResult>;
  release: (input: ReleaseInput, meta: EventMetadata) => Promise<ReleaseResult>;
  getInfo: () => Promise<ShowingInfo>;
  replayAsOf: (asOf: number) => Promise<ShowingAsOfView>;
  getEventsSince: (seq: number) => Promise<ProjectionMessage[]>;
  /** events を R2 退避＋プルーン（容量対策・Phase 10・NFR-14/16）。 */
  archiveOldEvents: () => Promise<ArchiveResult>;
};

// --- ReservationDO --------------------------------------------------------
export type StartInput = {
  reservationId: string;
  userId: string;
  showingId: string;
  organizationId: string;
  seatIds: string[];
  pricing: Pricing;
  requestedAt: number;
};
export type StartOk = { ok: true; holdExpiresAt: number };
export type StartResult = StartOk | RpcErr;

export type CancelInput = { requestedBy: string };
export type CancelResult = { ok: true } | RpcErr;

/** PI 作成直後の paymentIntentId 記録（与信 void 漏れ対策・FR-26/BR-11）。冪等。 */
export type AttachPaymentIntentInput = { paymentIntentId: string };
export type AttachPaymentIntentResult = { ok: true } | RpcErr;

/** オーソリ確保（webhook `amount_capturable_updated` 正本）→ ReservationAuthorized。 */
export type AuthorizeInput = {
  paymentIntentId: string;
  amount: number;
  applicationFeeAmount: number;
};
export type AuthorizeResult = { ok: true } | RpcErr;

/**
 * キャプチャ（route / webhook `succeeded` / 照合の統一入口）。**DO 所有**: Stripe capture は DO 内で
 * 冪等駆動するため入力は不要（meta のみ）。Authorized→Capturing（非失効）→Confirmed→BookSeats。
 */
export type CaptureResult = { ok: true } | RpcErr;

/** read-your-writes 用の予約ビュー（Reservation DO の現在状態。status は API 形＝小文字）。 */
export type ReservationView = {
  reservationId: string;
  userId: string | null;
  showingId: string | null;
  organizationId: string | null;
  status: string;
  seatIds: string[];
  pricing: Pricing | null;
  holdExpiresAt: number | null;
  paymentIntentId: string | null;
};

export type ReservationStub = {
  start: (input: StartInput, meta: EventMetadata) => Promise<StartResult>;
  attachPaymentIntent: (
    input: AttachPaymentIntentInput,
    meta: EventMetadata,
  ) => Promise<AttachPaymentIntentResult>;
  authorize: (
    input: AuthorizeInput,
    meta: EventMetadata,
  ) => Promise<AuthorizeResult>;
  capture: (meta: EventMetadata) => Promise<CaptureResult>;
  cancel: (input: CancelInput, meta: EventMetadata) => Promise<CancelResult>;
  view: () => Promise<ReservationView | null>;
  getEventsSince: (seq: number) => Promise<ProjectionMessage[]>;
  /** events を R2 退避＋プルーン（容量対策・Phase 10・NFR-14/16）。 */
  archiveOldEvents: () => Promise<ArchiveResult>;
};
