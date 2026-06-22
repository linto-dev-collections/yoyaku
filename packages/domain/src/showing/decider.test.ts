import { describe, expect, it } from "vitest";
import { replay } from "../decider";
import { DomainError } from "../errors";
import type { ReservationId, SeatId, UserId } from "../shared/ids";
import {
  asOrgId,
  asReservationId,
  asSeatId,
  asTicketTypeId,
  asUserId,
} from "../shared/ids";
import type { ShowingCommand } from "./commands";
import { showingDecider } from "./decider";
import type { ShowingEvent } from "./events";
import type { ShowingState } from "./state";

// --- 共通フィクスチャ ---------------------------------------------------------

const orgId = asOrgId("org_1");
const ttStd = asTicketTypeId("tt_std");
const resA = asReservationId("res_A");
const resB = asReservationId("res_B");
const userA = asUserId("user_A");
const userB = asUserId("user_B");
const seat1 = asSeatId("A-1");
const seat2 = asSeatId("A-2");

const ticketTypes = [
  { ticketTypeId: ttStd, name: "Standard", unitAmount: 5000, currency: "JPY" },
];

function registered(opts?: {
  salesStartAt?: number;
  salesEndAt?: number;
  currency?: string;
  ticketCurrency?: string;
}): ShowingEvent {
  return {
    type: "ShowingRegistered",
    organizationId: orgId,
    title: "Live",
    startsAt: 10_000,
    venue: "Hall",
    salesStartAt: opts?.salesStartAt,
    salesEndAt: opts?.salesEndAt,
    currency: opts?.currency ?? "JPY",
    ticketTypes: [
      {
        ticketTypeId: ttStd,
        name: "Standard",
        unitAmount: 5000,
        currency: opts?.ticketCurrency ?? "JPY",
      },
    ],
    totalSeats: 2,
  };
}

const SEATS_IMPORTED: ShowingEvent = {
  type: "SeatsImported",
  section: "A",
  seats: [
    { seatId: seat1, ticketTypeId: ttStd },
    { seatId: seat2, ticketTypeId: ttStd },
  ],
};

const PUBLISHED: ShowingEvent = { type: "ShowingPublished" };

function onSale(opts?: {
  salesStartAt?: number;
  salesEndAt?: number;
}): ShowingState {
  return replay(showingDecider, [registered(opts), SEATS_IMPORTED, PUBLISHED]);
}

function withHeld(
  reservation: ReservationId,
  user: UserId,
  seatIds: SeatId[],
): ShowingState {
  return replay(showingDecider, [
    registered(),
    SEATS_IMPORTED,
    PUBLISHED,
    {
      type: "SeatsHeld",
      reservationId: reservation,
      userId: user,
      seatIds,
      holdExpiresAt: 99_999,
    },
  ]);
}

function withBooked(
  reservation: ReservationId,
  user: UserId,
  seatIds: SeatId[],
): ShowingState {
  return replay(showingDecider, [
    registered(),
    SEATS_IMPORTED,
    PUBLISHED,
    {
      type: "SeatsHeld",
      reservationId: reservation,
      userId: user,
      seatIds,
      holdExpiresAt: 99_999,
    },
    { type: "SeatsBooked", reservationId: reservation, userId: user, seatIds },
  ]);
}

/** decide が DomainError を throw することを期待し、その error を返す。 */
function decideError(
  command: ShowingCommand,
  state: ShowingState,
): DomainError {
  try {
    showingDecider.decide(command, state);
  } catch (e) {
    if (e instanceof DomainError) return e;
    throw e;
  }
  throw new Error("expected decide() to throw DomainError but it returned");
}

// --- ImportSeats 重複/既存ガード（held/booked 席リセット防止） -----------------

describe("ImportSeats duplicate/existing guard", () => {
  const draftWithSeats = (): ShowingState =>
    replay(showingDecider, [registered(), SEATS_IMPORTED]);

  it("rejects re-importing a seatId that already exists", () => {
    const err = decideError(
      {
        type: "ImportSeats",
        section: "A",
        seats: [{ seatId: seat1, ticketTypeId: ttStd }],
      },
      draftWithSeats(),
    );
    expect(err.code).toBe("seat_conflict");
  });

  it("rejects duplicate seatIds within a single request", () => {
    const err = decideError(
      {
        type: "ImportSeats",
        section: "B",
        seats: [
          { seatId: asSeatId("B-1"), ticketTypeId: ttStd },
          { seatId: asSeatId("B-1"), ticketTypeId: ttStd },
        ],
      },
      replay(showingDecider, [registered()]),
    );
    expect(err.code).toBe("seat_conflict");
  });

  it("allows importing genuinely new seatIds into a draft", () => {
    const events = showingDecider.decide(
      {
        type: "ImportSeats",
        section: "B",
        seats: [{ seatId: asSeatId("B-1"), ticketTypeId: ttStd }],
      },
      draftWithSeats(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "SeatsImported", section: "B" });
  });

  it("prevents resetting held seats via unpublish → re-import", () => {
    // OnSale で seat1 を Held → 非公開化（Draft）→ seat1 を再投入しようとすると拒否。
    const draftAfterUnpublish = replay(showingDecider, [
      registered(),
      SEATS_IMPORTED,
      PUBLISHED,
      {
        type: "SeatsHeld",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
      },
      { type: "ShowingUnpublished", reason: "ops" },
    ]);
    expect(draftAfterUnpublish.status).toBe("Draft");
    expect(draftAfterUnpublish.seats.get(seat1)?.status).toBe("Held");
    const err = decideError(
      {
        type: "ImportSeats",
        section: "A",
        seats: [{ seatId: seat1, ticketTypeId: ttStd }],
      },
      draftAfterUnpublish,
    );
    expect(err.code).toBe("seat_conflict");
  });
});

// --- 通貨整合（FR-38） --------------------------------------------------------

describe("RegisterShowing currency consistency", () => {
  it("registers when the showing currency matches every ticket type", () => {
    const events = showingDecider.decide(
      {
        type: "RegisterShowing",
        organizationId: orgId,
        title: "Live",
        startsAt: 10_000,
        currency: "JPY",
        ticketTypes,
        totalSeats: 2,
      },
      showingDecider.initialState(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ShowingRegistered",
      currency: "JPY",
    });
  });

  it("rejects registration when a ticket type currency differs", () => {
    const err = decideError(
      {
        type: "RegisterShowing",
        organizationId: orgId,
        title: "Live",
        startsAt: 10_000,
        currency: "JPY",
        ticketTypes: [
          {
            ticketTypeId: ttStd,
            name: "Standard",
            unitAmount: 5000,
            currency: "USD",
          },
        ],
        totalSeats: 2,
      },
      showingDecider.initialState(),
    );
    expect(err.code).toBe("invalid_state");
  });
});

// --- 販売期間ガード（BR-04） --------------------------------------------------

describe("HoldSeats sales-window guard (BR-04)", () => {
  const window = { salesStartAt: 100, salesEndAt: 900 };

  it("rejects holds before the sales window opens", () => {
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
        requestedAt: 50,
      },
      onSale(window),
    );
    expect(err.code).toBe("invalid_state");
    expect(err.message).toContain("not started");
  });

  it("allows holds inside the sales window", () => {
    const events = showingDecider.decide(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
        requestedAt: 500,
      },
      onSale(window),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "SeatsHeld", seatIds: [seat1] });
  });

  it("rejects holds after the sales window closes", () => {
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
        requestedAt: 1_000,
      },
      onSale(window),
    );
    expect(err.code).toBe("invalid_state");
    expect(err.message).toContain("ended");
  });

  it("allows holds when no sales window is configured", () => {
    const events = showingDecider.decide(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
        requestedAt: 0,
      },
      onSale(),
    );
    expect(events).toHaveLength(1);
  });
});

// --- HoldSeats の冪等化（指摘 1） ---------------------------------------------

describe("HoldSeats idempotency", () => {
  it("is a no-op when the same reservation re-holds the same seats", () => {
    const events = showingDecider.decide(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
        requestedAt: 500,
      },
      withHeld(resA, userA, [seat1]),
    );
    expect(events).toEqual([]);
  });

  it("rejects holding a seat already held by another reservation", () => {
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resB,
        userId: userB,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
        requestedAt: 500,
      },
      withHeld(resA, userA, [seat1]),
    );
    expect(err.code).toBe("seat_conflict");
  });

  it("rejects a partial re-hold mixing an own held seat with an available seat", () => {
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1, seat2],
        holdExpiresAt: 99_999,
        requestedAt: 500,
      },
      withHeld(resA, userA, [seat1]),
    );
    expect(err.code).toBe("invalid_state");
  });
});

// --- BookSeats の冪等化（指摘 1） --------------------------------------------

describe("BookSeats idempotency", () => {
  it("books seats that are held by the reservation", () => {
    const events = showingDecider.decide(
      {
        type: "BookSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
      },
      withHeld(resA, userA, [seat1]),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "SeatsBooked",
      reservationId: resA,
    });
  });

  it("is a no-op when re-booking already booked seats", () => {
    const events = showingDecider.decide(
      {
        type: "BookSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
      },
      withBooked(resA, userA, [seat1]),
    );
    expect(events).toEqual([]);
  });

  it("rejects booking a seat not held by the reservation", () => {
    const err = decideError(
      {
        type: "BookSeats",
        reservationId: resB,
        userId: userB,
        seatIds: [seat1],
      },
      withHeld(resA, userA, [seat1]),
    );
    expect(err.code).toBe("invalid_state");
  });
});

// --- 在庫枯渇 → 完売遷移（ShowingSoldOut emit・FR-01/02/03） --------------------

describe("BookSeats sold-out emission", () => {
  /** seat1 は既に booked、seat2 を resB が hold 中（残り 1 席）の状態。 */
  function oneSeatLeftHeldBy(reservation: ReservationId): ShowingState {
    return replay(showingDecider, [
      registered(), // totalSeats: 2
      SEATS_IMPORTED, // seat1, seat2
      PUBLISHED,
      {
        type: "SeatsHeld",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
        holdExpiresAt: 99_999,
      },
      {
        type: "SeatsBooked",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
      },
      {
        type: "SeatsHeld",
        reservationId: reservation,
        userId: userB,
        seatIds: [seat2],
        holdExpiresAt: 99_999,
      },
    ]);
  }

  it("emits ShowingSoldOut together with SeatsBooked when the last seat is booked", () => {
    const events = showingDecider.decide(
      {
        type: "BookSeats",
        reservationId: resB,
        userId: userB,
        seatIds: [seat2],
      },
      oneSeatLeftHeldBy(resB),
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "SeatsBooked",
      reservationId: resB,
    });
    expect(events[1]).toEqual({ type: "ShowingSoldOut" });
    // 反映後の状態は SoldOut。
    const state = events.reduce(showingDecider.evolve, oneSeatLeftHeldBy(resB));
    expect(state.status).toBe("SoldOut");
  });

  it("does NOT emit ShowingSoldOut on a non-final booking (seats remain)", () => {
    const events = showingDecider.decide(
      {
        type: "BookSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
      },
      withHeld(resA, userA, [seat1]), // seat2 はまだ available（2 席中 1 席のみ booked）
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "SeatsBooked" });
  });

  it("does NOT emit ShowingSoldOut when totalSeats is 0", () => {
    // totalSeats=0（席なし）。理論上 hold/book は成立しないが、念のため emit ガードを検証。
    const state: ShowingState = {
      ...withHeld(resA, userA, [seat1]),
      totalSeats: 0,
    };
    const events = showingDecider.decide(
      {
        type: "BookSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1],
      },
      state,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "SeatsBooked" });
  });
});

// --- seatId 重複拒否（価格二重計上・上限過大・完売誤判定の防止） ----------------

describe("duplicate seatId rejection", () => {
  it("rejects HoldSeats with duplicate seatIds (seat_conflict)", () => {
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1, seat1],
        holdExpiresAt: 99_999,
        requestedAt: 500,
      },
      onSale(),
    );
    expect(err.code).toBe("seat_conflict");
  });

  it("rejects BookSeats with duplicate seatIds (invalid_state)", () => {
    const err = decideError(
      {
        type: "BookSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1, seat1],
      },
      withHeld(resA, userA, [seat1]),
    );
    expect(err.code).toBe("invalid_state");
  });
});

// --- 既存の遷移（是正後も緑であること） --------------------------------------

describe("existing showing lifecycle", () => {
  it("supports register → import → publish → hold → book", () => {
    let state = showingDecider.initialState();
    const apply = (command: ShowingCommand) => {
      const events = showingDecider.decide(command, state);
      state = events.reduce(showingDecider.evolve, state);
      return events;
    };

    apply({
      type: "RegisterShowing",
      organizationId: orgId,
      title: "Live",
      startsAt: 10_000,
      currency: "JPY",
      ticketTypes,
      totalSeats: 2,
    });
    expect(state.status).toBe("Draft");

    apply({
      type: "ImportSeats",
      section: "A",
      seats: [
        { seatId: seat1, ticketTypeId: ttStd },
        { seatId: seat2, ticketTypeId: ttStd },
      ],
    });
    apply({ type: "PublishShowing" });
    expect(state.status).toBe("OnSale");

    apply({
      type: "HoldSeats",
      reservationId: resA,
      userId: userA,
      seatIds: [seat1],
      holdExpiresAt: 99_999,
      requestedAt: 500,
    });
    expect(state.seats.get(seat1)?.status).toBe("Held");

    apply({
      type: "BookSeats",
      reservationId: resA,
      userId: userA,
      seatIds: [seat1],
    });
    expect(state.seats.get(seat1)?.status).toBe("Booked");
  });

  it("enforces the per-user purchase limit (FR-15/BR-05)", () => {
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1, seat2],
        holdExpiresAt: 99_999,
        requestedAt: 500,
        maxSeatsPerUser: 1,
      },
      onSale(),
    );
    expect(err.code).toBe("limit_exceeded");
  });

  it("公演別の購入上限（state.maxSeatsPerUser）が command 値より優先される（Phase 09）", () => {
    // 公演登録で上限 1 を確定 → command が 4 を渡しても state の 1 が効く。
    const onSaleLimited = replay(showingDecider, [
      { ...registered(), maxSeatsPerUser: 1 } as ShowingEvent,
      SEATS_IMPORTED,
      PUBLISHED,
    ]);
    const err = decideError(
      {
        type: "HoldSeats",
        reservationId: resA,
        userId: userA,
        seatIds: [seat1, seat2],
        holdExpiresAt: 99_999,
        requestedAt: 500,
        maxSeatsPerUser: 4,
      },
      onSaleLimited,
    );
    expect(err.code).toBe("limit_exceeded");
  });

  it("RegisterShowing は riskTier・maxSeatsPerUser の既定を確定する", () => {
    const events = showingDecider.decide(
      {
        type: "RegisterShowing",
        organizationId: orgId,
        title: "Live",
        startsAt: 10_000,
        currency: "JPY",
        ticketTypes,
        totalSeats: 2,
      },
      showingDecider.initialState(),
    );
    expect(events[0]).toMatchObject({
      type: "ShowingRegistered",
      riskTier: "general",
      maxSeatsPerUser: 4,
    });
  });
});
