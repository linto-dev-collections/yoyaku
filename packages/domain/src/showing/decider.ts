import type { Decider } from "../decider";
import { invalidState, limitExceeded, seatConflict } from "../errors";
import type { ShowingCommand } from "./commands";
import type { ShowingEvent } from "./events";
import { asRiskTier, DEFAULT_MAX_SEATS_PER_USER } from "./risk";
import {
  initialShowingState,
  type SeatState,
  type ShowingState,
} from "./state";

function evolve(state: ShowingState, event: ShowingEvent): ShowingState {
  switch (event.type) {
    case "ShowingRegistered":
      return {
        ...state,
        status: "Draft",
        organizationId: event.organizationId,
        title: event.title,
        startsAt: event.startsAt,
        venue: event.venue,
        salesStartAt: event.salesStartAt,
        salesEndAt: event.salesEndAt,
        currency: event.currency,
        totalSeats: event.totalSeats,
        // 旧イベント（区分なし）は general・上限は command フォールバックのため undefined のまま。
        riskTier: asRiskTier(event.riskTier),
        maxSeatsPerUser: event.maxSeatsPerUser,
      };
    case "SeatsImported": {
      const seats = new Map(state.seats);
      for (const s of event.seats) seats.set(s.seatId, { status: "Available" });
      return { ...state, seats };
    }
    case "ShowingPublished":
      return { ...state, status: "OnSale" };
    case "ShowingUnpublished":
      return { ...state, status: "Draft" };
    case "SeatsHeld": {
      const seats = new Map(state.seats);
      for (const id of event.seatIds)
        seats.set(id, { status: "Held", heldBy: event.reservationId });
      const holdsByUser = new Map(state.holdsByUser);
      holdsByUser.set(
        event.userId,
        (holdsByUser.get(event.userId) ?? 0) + event.seatIds.length,
      );
      return { ...state, seats, holdsByUser };
    }
    case "SeatsBooked": {
      const seats = new Map(state.seats);
      for (const id of event.seatIds)
        seats.set(id, { status: "Booked", bookedBy: event.reservationId });
      return { ...state, seats };
    }
    case "SeatsReleased": {
      const seats = new Map(state.seats);
      for (const id of event.seatIds) seats.set(id, { status: "Available" });
      const holdsByUser = new Map(state.holdsByUser);
      const cur = holdsByUser.get(event.userId) ?? 0;
      holdsByUser.set(event.userId, Math.max(0, cur - event.seatIds.length));
      return { ...state, seats, holdsByUser };
    }
    case "ShowingSoldOut":
      return { ...state, status: "SoldOut" };
    case "ShowingClosed":
      return { ...state, status: "Closed" };
    default:
      event satisfies never;
      return state;
  }
}

function decide(command: ShowingCommand, state: ShowingState): ShowingEvent[] {
  switch (command.type) {
    case "RegisterShowing": {
      if (state.status !== "None") throw invalidState("already registered");
      // 通貨整合（FR-38 価格固定）: 公演通貨と全席種通貨が一致すること。
      const mismatched = command.ticketTypes.find(
        (t) => t.currency !== command.currency,
      );
      if (mismatched)
        throw invalidState(
          `ticket type currency ${mismatched.currency} != showing currency ${command.currency}`,
        );
      return [
        {
          type: "ShowingRegistered",
          organizationId: command.organizationId,
          title: command.title,
          startsAt: command.startsAt,
          venue: command.venue,
          salesStartAt: command.salesStartAt,
          salesEndAt: command.salesEndAt,
          currency: command.currency,
          ticketTypes: command.ticketTypes,
          totalSeats: command.totalSeats,
          // 公平性/不正対策（Phase 09）。未指定は general・既定上限 4 を確定（全区分に上限を適用）。
          riskTier: asRiskTier(command.riskTier),
          maxSeatsPerUser:
            command.maxSeatsPerUser ?? DEFAULT_MAX_SEATS_PER_USER,
        },
      ];
    }
    case "ImportSeats": {
      if (state.status !== "Draft")
        throw invalidState("seats can be imported only in draft");
      // 既存 seatId の再投入を拒否（SeatsImported.evolve は無条件で Available 上書きするため、
      // unpublish→再投入で held/booked 席を空席化＝二重販売を招く）。リクエスト内重複も拒否。
      const seen = new Set<string>();
      for (const s of command.seats) {
        if (state.seats.has(s.seatId))
          throw seatConflict(`seat ${s.seatId} already imported`);
        if (seen.has(s.seatId))
          throw seatConflict(`duplicate seat ${s.seatId} in request`);
        seen.add(s.seatId);
      }
      return [
        {
          type: "SeatsImported",
          section: command.section,
          seats: command.seats,
        },
      ];
    }
    case "PublishShowing":
      if (state.status !== "Draft")
        throw invalidState("only draft can be published");
      return [{ type: "ShowingPublished" }];
    case "UnpublishShowing":
      if (state.status !== "OnSale")
        throw invalidState("only on_sale can be unpublished");
      return [{ type: "ShowingUnpublished", reason: command.reason }];
    case "HoldSeats": {
      // 各要求座席と当該予約の関係を分類（冪等判定・競合判定の基礎）。
      // - 当該予約で Held 済み → 再駆動（クラッシュ後の Saga 再実行）の候補
      // - Available → 新規確保の候補
      // - 別予約が Held / 誰かが Booked / 未知座席 → 競合（seat_conflict）
      // 重複 seatId を拒否（価格二重計上・購入上限の過大計上・完売誤判定を防ぐ・整合境界の防御）。
      if (new Set(command.seatIds).size !== command.seatIds.length)
        throw seatConflict("duplicate seatIds");
      let heldByThis = 0;
      for (const id of command.seatIds) {
        const seat: SeatState | undefined = state.seats.get(id);
        if (!seat) throw seatConflict(`unknown seat ${id}`);
        if (seat.status === "Held" && seat.heldBy === command.reservationId) {
          heldByThis++;
        } else if (seat.status !== "Available") {
          throw seatConflict(`seat ${id} is ${seat.status}`);
        }
      }
      // 冪等 no-op: 要求座席がすべて当該予約で Held 済み（DO クラッシュ後の再 hold）。
      if (heldByThis === command.seatIds.length) return [];
      // 自予約 Held と空席の混在は all-or-nothing 破れ＝不正系。
      if (heldByThis > 0)
        throw invalidState("partial re-hold for this reservation");
      // 以降は全席 Available（新規確保）であることが確定。

      // ここからは新規確保。ライフサイクル不変条件と販売期間ガード（BR-04）。
      if (state.status !== "OnSale")
        throw invalidState("showing is not on sale");
      if (
        state.salesStartAt !== undefined &&
        command.requestedAt < state.salesStartAt
      )
        throw invalidState("sales not started");
      if (
        state.salesEndAt !== undefined &&
        command.requestedAt > state.salesEndAt
      )
        throw invalidState("sales ended");
      // 購入上限（FR-15/BR-05）。公演別設定（state）を優先し、未設定なら command 値にフォールバック。
      const seatLimit = state.maxSeatsPerUser ?? command.maxSeatsPerUser;
      if (seatLimit !== undefined) {
        const held = state.holdsByUser.get(command.userId) ?? 0;
        if (held + command.seatIds.length > seatLimit) throw limitExceeded();
      }
      return [
        {
          type: "SeatsHeld",
          reservationId: command.reservationId,
          userId: command.userId,
          seatIds: command.seatIds,
          holdExpiresAt: command.holdExpiresAt,
        },
      ];
    }
    case "BookSeats": {
      // 冪等化（captured⇒booked の再試行・Phase 06）: すべて当該予約で Booked 済みなら no-op。
      // すべて当該予約で Held 中なら確定。別予約/未 Held・Booked と Held の混在は不正系。
      // 重複 seatId を拒否（SoldOut 判定が command.seatIds.length 依存のため・整合境界の防御）。
      if (new Set(command.seatIds).size !== command.seatIds.length)
        throw invalidState("duplicate seatIds");
      let bookedByThis = 0;
      for (const id of command.seatIds) {
        const seat = state.seats.get(id);
        if (
          seat?.status === "Booked" &&
          seat.bookedBy === command.reservationId
        ) {
          bookedByThis++;
        } else if (
          seat?.status !== "Held" ||
          seat.heldBy !== command.reservationId
        ) {
          throw invalidState(`seat ${id} not held by this reservation`);
        }
      }
      if (bookedByThis === command.seatIds.length) return [];
      if (bookedByThis > 0)
        throw invalidState("partial re-book for this reservation");
      const events: ShowingEvent[] = [
        {
          type: "SeatsBooked",
          reservationId: command.reservationId,
          userId: command.userId,
          seatIds: command.seatIds,
        },
      ];
      // 在庫枯渇 → 完売遷移（FR-01/02/03）。確定後の Booked 席数が総席数に達したら ShowingSoldOut も emit。
      // OnSale ガードで二重 emit を防止（SoldOut 後の再 book は上の冪等 no-op で到達しない）。
      const bookedAfter =
        [...state.seats.values()].filter((s) => s.status === "Booked").length +
        command.seatIds.length;
      if (
        state.status === "OnSale" &&
        state.totalSeats > 0 &&
        bookedAfter === state.totalSeats
      ) {
        events.push({ type: "ShowingSoldOut" });
      }
      return events;
    }
    case "ReleaseSeats": {
      // 冪等（BR-08）: この予約が Held 中の席のみ解放対象。
      const toRelease = command.seatIds.filter((id) => {
        const seat = state.seats.get(id);
        return seat?.status === "Held" && seat.heldBy === command.reservationId;
      });
      if (toRelease.length === 0) return [];
      return [
        {
          type: "SeatsReleased",
          reservationId: command.reservationId,
          userId: command.userId,
          seatIds: toRelease,
          cause: command.cause,
        },
      ];
    }
    case "CloseShowing":
      if (state.status === "Closed") return [];
      return [{ type: "ShowingClosed", reason: command.reason }];
    default:
      command satisfies never;
      throw invalidState("unknown command");
  }
}

export const showingDecider: Decider<
  ShowingCommand,
  ShowingState,
  ShowingEvent
> = {
  initialState: initialShowingState,
  decide,
  evolve,
};
