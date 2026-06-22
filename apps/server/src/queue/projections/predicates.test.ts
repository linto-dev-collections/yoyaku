import { describe, expect, it } from "vitest";
import {
  handles,
  isAggregateCreateEvent,
  RESERVATIONS_EVENTS,
  SALES_DASHBOARDS_EVENTS,
  SEAT_AVAILABILITIES_EVENTS,
  SHOWINGS_EVENTS,
  subscribesToAnyStream,
  subscribesToReservation,
  subscribesToSales,
  subscribesToShowing,
  TICKET_TYPES_EVENTS,
} from "./predicates";

describe("stream subscription", () => {
  it("showing projections subscribe to the Showing stream only", () => {
    expect(subscribesToShowing("Showing")).toBe(true);
    expect(subscribesToShowing("Reservation")).toBe(false);
  });

  it("reservation projections subscribe to the Reservation stream only", () => {
    expect(subscribesToReservation("Reservation")).toBe(true);
    expect(subscribesToReservation("Showing")).toBe(false);
  });

  it("sales_dashboards subscribes to BOTH streams (2 ストリーム集約)", () => {
    expect(subscribesToSales("Showing")).toBe(true);
    expect(subscribesToSales("Reservation")).toBe(true);
  });

  it("aggregate_registry subscribes to every stream", () => {
    expect(subscribesToAnyStream("Showing")).toBe(true);
    expect(subscribesToAnyStream("Reservation")).toBe(true);
  });
});

describe("isAggregateCreateEvent (registry trigger)", () => {
  it("matches each stream's creation event only", () => {
    expect(isAggregateCreateEvent("Showing", "ShowingRegistered")).toBe(true);
    expect(isAggregateCreateEvent("Reservation", "ReservationInitiated")).toBe(
      true,
    );
  });

  it("ignores non-creation events and cross-stream mismatches", () => {
    expect(isAggregateCreateEvent("Showing", "ShowingPublished")).toBe(false);
    expect(isAggregateCreateEvent("Showing", "SeatsHeld")).toBe(false);
    expect(isAggregateCreateEvent("Reservation", "ReservationHeld")).toBe(
      false,
    );
    // ストリーム取り違え（イベント名は他ストリームの作成イベント）も登録しない。
    expect(isAggregateCreateEvent("Reservation", "ShowingRegistered")).toBe(
      false,
    );
    expect(isAggregateCreateEvent("Showing", "ReservationInitiated")).toBe(
      false,
    );
  });
});

describe("handles truth table", () => {
  it("showings projection handles lifecycle events", () => {
    expect(handles(SHOWINGS_EVENTS, "ShowingRegistered")).toBe(true);
    expect(handles(SHOWINGS_EVENTS, "ShowingPublished")).toBe(true);
    expect(handles(SHOWINGS_EVENTS, "ShowingSoldOut")).toBe(true);
    expect(handles(SHOWINGS_EVENTS, "SeatsImported")).toBe(false);
    expect(handles(SHOWINGS_EVENTS, "SeatsHeld")).toBe(false);
  });

  it("ticket_types projection handles only ShowingRegistered", () => {
    expect(handles(TICKET_TYPES_EVENTS, "ShowingRegistered")).toBe(true);
    expect(handles(TICKET_TYPES_EVENTS, "ShowingPublished")).toBe(false);
    expect(handles(TICKET_TYPES_EVENTS, "SeatsImported")).toBe(false);
  });

  it("seat_availabilities projection handles seat events", () => {
    expect(handles(SEAT_AVAILABILITIES_EVENTS, "SeatsImported")).toBe(true);
    expect(handles(SEAT_AVAILABILITIES_EVENTS, "SeatsHeld")).toBe(true);
    expect(handles(SEAT_AVAILABILITIES_EVENTS, "SeatsBooked")).toBe(true);
    expect(handles(SEAT_AVAILABILITIES_EVENTS, "SeatsReleased")).toBe(true);
    expect(handles(SEAT_AVAILABILITIES_EVENTS, "ShowingRegistered")).toBe(
      false,
    );
  });

  it("reservations projection handles the reservation lifecycle", () => {
    expect(handles(RESERVATIONS_EVENTS, "ReservationInitiated")).toBe(true);
    expect(handles(RESERVATIONS_EVENTS, "ReservationHeld")).toBe(true);
    // PI 早期記録（与信 void 漏れ対策・FR-26）も read model に反映する。
    expect(handles(RESERVATIONS_EVENTS, "ReservationPaymentPending")).toBe(
      true,
    );
    expect(handles(RESERVATIONS_EVENTS, "ReservationExpired")).toBe(true);
    expect(handles(RESERVATIONS_EVENTS, "ReservationCancelled")).toBe(true);
    expect(handles(RESERVATIONS_EVENTS, "ReservationFailed")).toBe(true);
    expect(handles(RESERVATIONS_EVENTS, "SeatsHeld")).toBe(false);
  });

  it("sales_dashboards projection handles seat-count, hold-count and confirmed-sale events", () => {
    expect(handles(SALES_DASHBOARDS_EVENTS, "ShowingRegistered")).toBe(true);
    expect(handles(SALES_DASHBOARDS_EVENTS, "SeatsImported")).toBe(true);
    expect(handles(SALES_DASHBOARDS_EVENTS, "SeatsHeld")).toBe(true);
    expect(handles(SALES_DASHBOARDS_EVENTS, "SeatsBooked")).toBe(true);
    expect(handles(SALES_DASHBOARDS_EVENTS, "SeatsReleased")).toBe(true);
    // hold 到達は holdCount の絶対再計算トリガー、confirmed は件数/売上トリガー。
    expect(handles(SALES_DASHBOARDS_EVENTS, "ReservationHeld")).toBe(true);
    expect(handles(SALES_DASHBOARDS_EVENTS, "ReservationConfirmed")).toBe(true);
    // 統計に影響しない予約イベントは対象外（再計算の無駄打ちを避ける真偽表）。
    expect(handles(SALES_DASHBOARDS_EVENTS, "ReservationInitiated")).toBe(
      false,
    );
    expect(handles(SALES_DASHBOARDS_EVENTS, "ReservationCancelled")).toBe(
      false,
    );
  });
});
