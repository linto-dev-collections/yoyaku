import { describe, expect, it } from "vitest";
import { replay } from "../decider";
import { DomainError } from "../errors";
import { asOrgId, asSeatId, asShowingId, asUserId } from "../shared/ids";
import type { ReservationCommand } from "./commands";
import { reservationDecider } from "./decider";
import type { ReservationEvent } from "./events";
import { isExpirable, type ReservationState } from "./state";

// --- 共通フィクスチャ ---------------------------------------------------------

const userA = asUserId("user_A");
const orgId = asOrgId("org_1");
const showingId = asShowingId("show_1");
const seat1 = asSeatId("A-1");
const seat2 = asSeatId("A-2");

const pricing = {
  quantity: 2,
  subtotalAmount: 10_000,
  applicationFeeAmount: 0,
  totalAmount: 10_000,
  currency: "JPY",
};

const INITIATED: ReservationEvent = {
  type: "ReservationInitiated",
  userId: userA,
  showingId,
  organizationId: orgId,
  seatIds: [seat1, seat2],
  pricing,
};

const start = (): ReservationCommand => ({
  type: "StartReservation",
  userId: userA,
  showingId,
  organizationId: orgId,
  seatIds: [seat1, seat2],
  pricing,
});

/** decide が DomainError を throw することを期待し、その error を返す。 */
function decideError(
  command: ReservationCommand,
  state: ReservationState,
): DomainError {
  try {
    reservationDecider.decide(command, state);
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error("expected decide() to throw DomainError but it returned");
}

// --- StartReservation --------------------------------------------------------

describe("StartReservation", () => {
  it("emits ReservationInitiated from the initial state with fixed pricing", () => {
    const events = reservationDecider.decide(
      start(),
      reservationDecider.initialState(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ReservationInitiated",
      userId: userA,
      showingId,
      seatIds: [seat1, seat2],
      pricing,
    });
  });

  it("evolves to Initiated and carries the reservation context", () => {
    const state = replay(reservationDecider, [INITIATED]);
    expect(state.status).toBe("Initiated");
    expect(state.showingId).toBe(showingId);
    expect(state.pricing).toEqual(pricing);
  });

  it("rejects starting an already started reservation", () => {
    const err = decideError(start(), replay(reservationDecider, [INITIATED]));
    expect(err.code).toBe("invalid_state");
  });
});

// --- Hold 統合（MarkHeld / MarkHoldRejected） --------------------------------

describe("hold integration", () => {
  it("MarkHeld transitions Initiated → AwaitingPayment with holdExpiresAt", () => {
    const state = replay(reservationDecider, [INITIATED]);
    const events = reservationDecider.decide(
      { type: "MarkHeld", holdExpiresAt: 99_999 },
      state,
    );
    expect(events).toEqual([
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
    ]);
    expect(replay(reservationDecider, [INITIATED, ...events]).status).toBe(
      "AwaitingPayment",
    );
  });

  it("MarkHoldRejected transitions Initiated → Failed", () => {
    const state = replay(reservationDecider, [INITIATED]);
    const events = reservationDecider.decide(
      { type: "MarkHoldRejected", reason: "seat_conflict" },
      state,
    );
    expect(events).toEqual([
      { type: "ReservationFailed", reason: "seat_conflict" },
    ]);
    expect(replay(reservationDecider, [INITIATED, ...events]).status).toBe(
      "Failed",
    );
  });

  it("rejects MarkHeld when not awaiting a hold", () => {
    const err = decideError(
      { type: "MarkHeld", holdExpiresAt: 1 },
      reservationDecider.initialState(),
    );
    expect(err.code).toBe("invalid_state");
  });
});

// --- PI 記録（AttachPaymentIntent・与信 void 漏れ対策 FR-26/BR-11） -----------

describe("attach payment intent", () => {
  const awaiting = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
    ]);

  it("records the payment intent id without changing status (stays AwaitingPayment)", () => {
    const events = reservationDecider.decide(
      { type: "AttachPaymentIntent", paymentIntentId: "pi_1" },
      awaiting(),
    );
    expect(events).toEqual([
      { type: "ReservationPaymentPending", paymentIntentId: "pi_1" },
    ]);
    const state = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      ...events,
    ]);
    expect(state.status).toBe("AwaitingPayment");
    expect(state.paymentIntentId).toBe("pi_1");
  });

  it("is idempotent when the same payment intent is already recorded", () => {
    const withPi = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      { type: "ReservationPaymentPending", paymentIntentId: "pi_1" },
    ]);
    expect(
      reservationDecider.decide(
        { type: "AttachPaymentIntent", paymentIntentId: "pi_1" },
        withPi,
      ),
    ).toEqual([]);
  });

  it("rejects attaching before a hold (not awaiting payment)", () => {
    const err = decideError(
      { type: "AttachPaymentIntent", paymentIntentId: "pi_1" },
      replay(reservationDecider, [INITIATED]),
    );
    expect(err.code).toBe("invalid_state");
  });

  it("keeps the payment intent so a later Expire can void the authorization (FR-26)", () => {
    // PI 記録済み → 失効しても state.paymentIntentId が残り、DO terminate が void 効果を作れる。
    const pending = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      { type: "ReservationPaymentPending", paymentIntentId: "pi_1" },
    ]);
    const expired = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      { type: "ReservationPaymentPending", paymentIntentId: "pi_1" },
      { type: "ReservationExpired" },
    ]);
    expect(pending.paymentIntentId).toBe("pi_1");
    expect(expired.status).toBe("Expired");
    expect(expired.paymentIntentId).toBe("pi_1");
  });
});

// --- 決済段階（Authorize / Capture・Phase 06 で配線） -------------------------

describe("payment transitions", () => {
  const heldState = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
    ]);

  it("Authorize requires AwaitingPayment and records the payment intent", () => {
    const events = reservationDecider.decide(
      {
        type: "Authorize",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
      heldState(),
    );
    expect(events[0]).toMatchObject({
      type: "ReservationAuthorized",
      paymentIntentId: "pi_1",
    });
  });

  it("rejects Authorize before a hold", () => {
    const err = decideError(
      {
        type: "Authorize",
        paymentIntentId: "pi_1",
        amount: 1,
        applicationFeeAmount: 0,
      },
      replay(reservationDecider, [INITIATED]),
    );
    expect(err.code).toBe("invalid_state");
  });

  it("Capture confirms a capturing reservation with attribution", () => {
    const capturing = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
      { type: "ReservationCaptureStarted" },
    ]);
    const events = reservationDecider.decide(
      {
        type: "Capture",
        capturedAmount: 10_000,
        currency: "JPY",
        capturedAt: 5,
      },
      capturing,
    );
    expect(events[0]).toMatchObject({
      type: "ReservationConfirmed",
      showingId,
      organizationId: orgId,
      capturedAmount: 10_000,
      currency: "JPY",
    });
  });

  it("ReservationConfirmed carries the fixed application fee from pricing, not the capture command (FR-38/BR-14)", () => {
    const fixed = { ...pricing, applicationFeeAmount: 1_000 };
    const authorized = replay(reservationDecider, [
      {
        type: "ReservationInitiated",
        userId: userA,
        showingId,
        organizationId: orgId,
        seatIds: [seat1, seat2],
        pricing: fixed,
      },
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 1_000,
      },
      { type: "ReservationCaptureStarted" },
    ]);
    const events = reservationDecider.decide(
      {
        type: "Capture",
        capturedAmount: 10_000,
        currency: "JPY",
        capturedAt: 5,
      },
      authorized,
    );
    expect(events[0]).toMatchObject({
      type: "ReservationConfirmed",
      applicationFeeAmount: 1_000,
    });
  });
});

// --- 金額固定の不変条件（FR-38/BR-14・decide で強制） ------------------------

describe("payment amount invariants (FR-38/BR-14)", () => {
  const heldState = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
    ]);

  const capturingState = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
      { type: "ReservationCaptureStarted" },
    ]);

  it("rejects Authorize when the amount differs from the fixed total", () => {
    const err = decideError(
      {
        type: "Authorize",
        paymentIntentId: "pi_1",
        amount: 9_999, // 固定額 10_000 と不一致
        applicationFeeAmount: 0,
      },
      heldState(),
    );
    expect(err.code).toBe("amount_mismatch");
  });

  it("rejects Authorize when the application fee differs from the fixed fee", () => {
    const err = decideError(
      {
        type: "Authorize",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 500, // 固定手数料 0 と不一致
      },
      heldState(),
    );
    expect(err.code).toBe("amount_mismatch");
  });

  it("rejects Capture when the captured amount differs from the fixed total", () => {
    const err = decideError(
      {
        type: "Capture",
        capturedAmount: 9_000, // 部分キャプチャ＝固定額 10_000 と不一致
        currency: "JPY",
        capturedAt: 5,
      },
      capturingState(),
    );
    expect(err.code).toBe("amount_mismatch");
  });

  it("rejects Capture when the currency differs from the fixed currency", () => {
    const err = decideError(
      {
        type: "Capture",
        capturedAmount: 10_000,
        currency: "USD", // 固定通貨 JPY と不一致
        capturedAt: 5,
      },
      capturingState(),
    );
    expect(err.code).toBe("amount_mismatch");
  });

  it("accepts Authorize/Capture when amount and currency match the fixed pricing", () => {
    expect(
      reservationDecider.decide(
        {
          type: "Authorize",
          paymentIntentId: "pi_1",
          amount: 10_000,
          applicationFeeAmount: 0,
        },
        heldState(),
      ),
    ).toHaveLength(1);
    expect(
      reservationDecider.decide(
        {
          type: "Capture",
          capturedAmount: 10_000,
          currency: "JPY",
          capturedAt: 5,
        },
        capturingState(),
      ),
    ).toHaveLength(1);
  });
});

// --- capture 着手（BeginCapture/Capturing・capture×失効競合の解消） -----------

describe("begin capture (non-expirable Capturing)", () => {
  const authorized = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
    ]);

  const capturing = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
      { type: "ReservationCaptureStarted" },
    ]);

  it("BeginCapture transitions Authorized → Capturing", () => {
    const events = reservationDecider.decide(
      { type: "BeginCapture" },
      authorized(),
    );
    expect(events).toEqual([{ type: "ReservationCaptureStarted" }]);
    expect(capturing().status).toBe("Capturing");
  });

  it("Capturing is NOT expirable (hold 失効で席解放しない)", () => {
    expect(isExpirable("Capturing")).toBe(false);
  });

  it("Expire is a no-op while Capturing (入金あり・席なし防止)", () => {
    expect(reservationDecider.decide({ type: "Expire" }, capturing())).toEqual(
      [],
    );
  });

  it("Cancel is rejected while Capturing (capture 進行中は取消不可)", () => {
    const err = decideError({ type: "Cancel" }, capturing());
    expect(err.code).toBe("invalid_state");
  });

  it("BeginCapture is idempotent once Capturing", () => {
    expect(
      reservationDecider.decide({ type: "BeginCapture" }, capturing()),
    ).toEqual([]);
  });

  it("rejects BeginCapture before authorization", () => {
    const err = decideError(
      { type: "BeginCapture" },
      replay(reservationDecider, [
        INITIATED,
        { type: "ReservationHeld", holdExpiresAt: 99_999 },
      ]),
    );
    expect(err.code).toBe("invalid_state");
  });

  it("rejects Capture directly from Authorized (must go through BeginCapture)", () => {
    const err = decideError(
      {
        type: "Capture",
        capturedAmount: 10_000,
        currency: "JPY",
        capturedAt: 5,
      },
      authorized(),
    );
    expect(err.code).toBe("invalid_state");
  });
});

// --- 終端・冪等（Expire / Cancel・BR-03/BR-10） ------------------------------

describe("terminal transitions and idempotency", () => {
  const awaiting = (): ReservationState =>
    replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
    ]);

  it("Expire emits ReservationExpired from AwaitingPayment", () => {
    const events = reservationDecider.decide({ type: "Expire" }, awaiting());
    expect(events).toEqual([{ type: "ReservationExpired" }]);
  });

  it("Expire is a no-op once confirmed/cancelled/expired (BR-10)", () => {
    const confirmed = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
      {
        type: "ReservationConfirmed",
        showingId,
        organizationId: orgId,
        capturedAmount: 10_000,
        applicationFeeAmount: 0,
        currency: "JPY",
        confirmedAt: 1,
      },
    ]);
    expect(reservationDecider.decide({ type: "Expire" }, confirmed)).toEqual(
      [],
    );
  });

  it("Cancel is rejected after confirmation (BR-03: confirmed is final)", () => {
    const confirmed = replay(reservationDecider, [
      INITIATED,
      { type: "ReservationHeld", holdExpiresAt: 99_999 },
      {
        type: "ReservationAuthorized",
        paymentIntentId: "pi_1",
        amount: 10_000,
        applicationFeeAmount: 0,
      },
      {
        type: "ReservationConfirmed",
        showingId,
        organizationId: orgId,
        capturedAmount: 10_000,
        applicationFeeAmount: 0,
        currency: "JPY",
        confirmedAt: 1,
      },
    ]);
    const err = decideError({ type: "Cancel" }, confirmed);
    expect(err.code).toBe("invalid_state");
  });

  it("Cancel emits ReservationCancelled from AwaitingPayment", () => {
    const events = reservationDecider.decide({ type: "Cancel" }, awaiting());
    expect(events).toEqual([{ type: "ReservationCancelled" }]);
  });
});

// --- 失効対象判定（isExpirable・hold alarm の冪等ガード） --------------------

describe("isExpirable", () => {
  it("treats held-but-unconfirmed states as expirable", () => {
    expect(isExpirable("AwaitingPayment")).toBe(true);
    expect(isExpirable("Authorized")).toBe(true);
  });

  it("treats terminal/pre-hold states as non-expirable", () => {
    for (const status of [
      "None",
      "Initiated",
      "Confirmed",
      "Cancelled",
      "Expired",
      "PaymentFailed",
      "Failed",
    ] as const) {
      expect(isExpirable(status)).toBe(false);
    }
  });
});
