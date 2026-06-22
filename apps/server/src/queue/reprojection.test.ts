import { describe, expect, it } from "vitest";
import { streamsForProjections, withCascadeResets } from "./reprojection-plan";

describe("streamsForProjections", () => {
  it("maps showings/ticket_types/seat_availabilities to the Showing stream only", () => {
    expect(streamsForProjections(["showings"])).toEqual({
      showing: true,
      reservation: false,
    });
    expect(
      streamsForProjections(["ticket_types", "seat_availabilities"]),
    ).toEqual({ showing: true, reservation: false });
  });

  it("maps reservations to the Reservation stream only (指摘5a)", () => {
    expect(streamsForProjections(["reservations"])).toEqual({
      showing: false,
      reservation: true,
    });
  });

  it("maps sales_dashboards to both Showing and Reservation streams", () => {
    expect(streamsForProjections(["sales_dashboards"])).toEqual({
      showing: true,
      reservation: true,
    });
  });

  it("unions the streams across a mixed set", () => {
    expect(streamsForProjections(["showings", "sales_dashboards"])).toEqual({
      showing: true,
      reservation: true,
    });
  });

  it("returns no streams for an empty set", () => {
    expect(streamsForProjections([])).toEqual({
      showing: false,
      reservation: false,
    });
  });
});

describe("withCascadeResets", () => {
  it("adds ticket_types and seat_availabilities when showings is reset (FK cascade)", () => {
    expect(withCascadeResets(["showings"])).toEqual([
      "showings",
      "ticket_types",
      "seat_availabilities",
    ]);
  });

  it("leaves non-cascading sets unchanged (stable order)", () => {
    expect(withCascadeResets(["sales_dashboards"])).toEqual([
      "sales_dashboards",
    ]);
    expect(withCascadeResets(["seat_availabilities"])).toEqual([
      "seat_availabilities",
    ]);
    // reservations は FK cascade 無し＝独立（指摘5a）。
    expect(withCascadeResets(["reservations"])).toEqual(["reservations"]);
  });

  it("deduplicates and normalizes order", () => {
    expect(
      withCascadeResets([
        "seat_availabilities",
        "showings",
        "sales_dashboards",
      ]),
    ).toEqual([
      "showings",
      "ticket_types",
      "seat_availabilities",
      "sales_dashboards",
    ]);
  });
});
