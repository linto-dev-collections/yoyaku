import type { Decider } from "../decider";
import { amountMismatch, invalidState } from "../errors";
import type { ReservationCommand } from "./commands";
import type { ReservationEvent } from "./events";
import { initialReservationState, type ReservationState } from "./state";

// Saga の副作用（Showing への HoldSeats/BookSeats/ReleaseSeats、Stripe オーソリ/キャプチャ/void、
// captured⇒booked の補償リトライ FR-39）はアプリ/DO 層が担う。本 decider は純粋な状態遷移のみ。

function evolve(
  state: ReservationState,
  event: ReservationEvent,
): ReservationState {
  switch (event.type) {
    case "ReservationInitiated":
      return {
        ...state,
        status: "Initiated",
        userId: event.userId,
        showingId: event.showingId,
        organizationId: event.organizationId,
        seatIds: event.seatIds,
        pricing: event.pricing,
      };
    case "ReservationHeld":
      return {
        ...state,
        status: "AwaitingPayment",
        holdExpiresAt: event.holdExpiresAt,
      };
    case "ReservationFailed":
      return { ...state, status: "Failed" };
    case "ReservationPaymentPending":
      // paymentIntentId だけ記録（status は AwaitingPayment のまま）。
      return { ...state, paymentIntentId: event.paymentIntentId };
    case "ReservationAuthorized":
      return {
        ...state,
        status: "Authorized",
        paymentIntentId: event.paymentIntentId,
      };
    case "ReservationCaptureStarted":
      // capture 着手＝非失効（Capturing）。alarm の Expire を抑止し席解放を防ぐ。
      return { ...state, status: "Capturing" };
    case "ReservationConfirmed":
      return { ...state, status: "Confirmed" };
    case "ReservationExpired":
      return { ...state, status: "Expired" };
    case "ReservationPaymentFailed":
      return { ...state, status: "PaymentFailed" };
    case "ReservationCancelled":
      return { ...state, status: "Cancelled" };
    default:
      event satisfies never;
      return state;
  }
}

function decide(
  command: ReservationCommand,
  state: ReservationState,
): ReservationEvent[] {
  switch (command.type) {
    case "StartReservation":
      if (state.status !== "None")
        throw invalidState("reservation already started");
      return [
        {
          type: "ReservationInitiated",
          userId: command.userId,
          showingId: command.showingId,
          organizationId: command.organizationId,
          seatIds: command.seatIds,
          pricing: command.pricing,
        },
      ];
    case "MarkHeld":
      if (state.status !== "Initiated") throw invalidState("not awaiting hold");
      return [
        { type: "ReservationHeld", holdExpiresAt: command.holdExpiresAt },
      ];
    case "MarkHoldRejected":
      if (state.status !== "Initiated") throw invalidState("not awaiting hold");
      return [{ type: "ReservationFailed", reason: command.reason }];
    case "AttachPaymentIntent":
      // 冪等: 同じ PI が既に記録済みなら no-op（authorize 後に再記録しに来ても安全）。
      if (state.paymentIntentId === command.paymentIntentId) return [];
      // 決済待ち（hold 済み）でのみ記録。失効/取消後など終端では拒否（与信は補償が処理）。
      if (state.status !== "AwaitingPayment")
        throw invalidState("cannot attach payment intent");
      return [
        {
          type: "ReservationPaymentPending",
          paymentIntentId: command.paymentIntentId,
        },
      ];
    case "Authorize": {
      if (state.status !== "AwaitingPayment")
        throw invalidState("not awaiting payment");
      // 価格固定（FR-38/BR-14）: オーソリ額・手数料は確保時の固定額と一致すること。
      // route だけでなく decide で強制し、webhook/照合経由でも不一致を **記録せず reject** する
      // （事後検知の照合ジョブに先んじて状態遷移で防ぐ・多層防御）。
      if (!state.pricing) throw invalidState("missing pricing");
      if (
        command.amount !== state.pricing.totalAmount ||
        command.applicationFeeAmount !== state.pricing.applicationFeeAmount
      )
        throw amountMismatch(
          `authorize ${command.amount}/${command.applicationFeeAmount} != fixed ${state.pricing.totalAmount}/${state.pricing.applicationFeeAmount}`,
        );
      return [
        {
          type: "ReservationAuthorized",
          paymentIntentId: command.paymentIntentId,
          amount: command.amount,
          applicationFeeAmount: command.applicationFeeAmount,
        },
      ];
    }
    case "BeginCapture":
      // 冪等: 既に Capturing/Confirmed なら no-op（再駆動・再試行に安全）。
      if (state.status === "Capturing" || state.status === "Confirmed")
        return [];
      // Authorized からのみ着手可。これ以降 Capturing は失効対象外（capture×失効競合の解消）。
      if (state.status !== "Authorized") throw invalidState("not authorized");
      return [{ type: "ReservationCaptureStarted" }];
    case "Capture": {
      // capture は **Capturing**（着手済み）からのみ確定（Authorized から直接は不可＝必ず BeginCapture 経由）。
      if (state.status !== "Capturing") throw invalidState("not capturing");
      if (!state.showingId || !state.organizationId || !state.pricing) {
        throw invalidState("missing reservation context");
      }
      // 価格固定（FR-38/BR-14）: キャプチャ額・通貨は確保時の固定額と一致すること（部分キャプチャ/
      // 通貨差異/金額改竄を状態遷移で reject）。currency は Stripe→大文字で正規化済み（route/webhook/照合）。
      if (
        command.capturedAmount !== state.pricing.totalAmount ||
        command.currency !== state.pricing.currency
      )
        throw amountMismatch(
          `capture ${command.capturedAmount} ${command.currency} != fixed ${state.pricing.totalAmount} ${state.pricing.currency}`,
        );
      return [
        {
          type: "ReservationConfirmed",
          showingId: state.showingId,
          organizationId: state.organizationId,
          capturedAmount: command.capturedAmount,
          applicationFeeAmount: state.pricing.applicationFeeAmount,
          currency: command.currency,
          confirmedAt: command.capturedAt,
        },
      ];
    }
    case "Expire":
      // 冪等（BR-10）: 既に確定/取消/失効済みは no-op。Capturing（capture 進行中）も失効させない
      // （非失効＝席解放しない・「入金あり・席なし」防止）。万一 Expire が来ても no-op。
      if (
        ["Confirmed", "Capturing", "Cancelled", "Expired", "Failed"].includes(
          state.status,
        )
      )
        return [];
      return [{ type: "ReservationExpired" }];
    case "Cancel":
      // 確定=最終（BR-03）: 確定後の購入者起点キャンセルは不可。capture 進行中も不可（入金確定途上）。
      if (state.status === "Confirmed")
        throw invalidState("confirmed reservation is final");
      if (state.status === "Capturing")
        throw invalidState("capture in progress");
      if (["Cancelled", "Expired", "Failed"].includes(state.status)) return [];
      return [{ type: "ReservationCancelled" }];
    case "MarkPaymentFailed":
      if (state.status === "Confirmed") return [];
      return [{ type: "ReservationPaymentFailed", cause: command.cause }];
    default:
      command satisfies never;
      throw invalidState("unknown command");
  }
}

export const reservationDecider: Decider<
  ReservationCommand,
  ReservationState,
  ReservationEvent
> = {
  initialState: initialReservationState,
  decide,
  evolve,
};
