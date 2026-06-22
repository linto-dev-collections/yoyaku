import { describe, expect, it } from "vitest";
import {
  classifyReconciliation,
  isAutoCorrectable,
  type ReconciliationFact,
} from "./reconciliation";

const fact = (over: Partial<ReconciliationFact>): ReconciliationFact => ({
  reservationStatus: "confirmed",
  paymentIntentStatus: "succeeded",
  seatsBooked: true,
  expectedAmount: 5000,
  capturedAmount: 5000,
  holdExpired: false,
  ...over,
});

describe("classifyReconciliation", () => {
  it("returns null when paid and seats booked at the fixed amount", () => {
    expect(classifyReconciliation(fact({}))).toBeNull();
  });

  it("paid_no_seat: PI succeeded but seats not booked", () => {
    expect(classifyReconciliation(fact({ seatsBooked: false }))).toBe(
      "paid_no_seat",
    );
  });

  it("paid_no_seat takes precedence over amount mismatch", () => {
    // booked でない方が是正の実効性が高いので優先。
    expect(
      classifyReconciliation(
        fact({ seatsBooked: false, capturedAmount: 4000 }),
      ),
    ).toBe("paid_no_seat");
  });

  it("amount_mismatch: captured amount differs from the fixed amount", () => {
    expect(classifyReconciliation(fact({ capturedAmount: 4000 }))).toBe(
      "amount_mismatch",
    );
  });

  it("does not flag amount_mismatch when captured amount is unknown", () => {
    expect(classifyReconciliation(fact({ capturedAmount: null }))).toBeNull();
  });

  it("dangling_auth: requires_capture while the reservation is terminated", () => {
    expect(
      classifyReconciliation(
        fact({
          reservationStatus: "expired",
          paymentIntentStatus: "requires_capture",
          seatsBooked: false,
          capturedAmount: null,
        }),
      ),
    ).toBe("dangling_auth");
  });

  it("dangling_auth: requires_capture while the hold has expired", () => {
    expect(
      classifyReconciliation(
        fact({
          reservationStatus: "authorized",
          paymentIntentStatus: "requires_capture",
          seatsBooked: false,
          capturedAmount: null,
          holdExpired: true,
        }),
      ),
    ).toBe("dangling_auth");
  });

  it("does not flag dangling_auth for a healthy authorized-and-waiting PI", () => {
    expect(
      classifyReconciliation(
        fact({
          reservationStatus: "authorized",
          paymentIntentStatus: "requires_capture",
          seatsBooked: false,
          capturedAmount: null,
          holdExpired: false,
        }),
      ),
    ).toBeNull();
  });

  it("seat_no_paid: seats booked but PI not succeeded (should not happen by design)", () => {
    expect(
      classifyReconciliation(
        fact({
          reservationStatus: "confirmed",
          paymentIntentStatus: "requires_capture",
          seatsBooked: true,
          capturedAmount: null,
        }),
      ),
    ).toBe("seat_no_paid");
  });

  it("returns null when there is no PaymentIntent yet and no seats booked", () => {
    expect(
      classifyReconciliation(
        fact({
          reservationStatus: "awaiting_payment",
          paymentIntentStatus: null,
          seatsBooked: false,
          capturedAmount: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("isAutoCorrectable", () => {
  it("auto-corrects paid_no_seat and dangling_auth", () => {
    expect(isAutoCorrectable("paid_no_seat")).toBe(true);
    expect(isAutoCorrectable("dangling_auth")).toBe(true);
  });

  it("leaves seat_no_paid and amount_mismatch for manual review", () => {
    expect(isAutoCorrectable("seat_no_paid")).toBe(false);
    expect(isAutoCorrectable("amount_mismatch")).toBe(false);
  });
});
