import { DurableObject } from "cloudflare:workers";
import {
  asReservationId,
  asSeatId,
  asUserId,
  DomainError,
  initialShowingState,
  type SeatId,
  type SeatState,
  type ShowingCommand,
  type ShowingEvent,
  type ShowingState,
  showingDecider,
  type UserId,
} from "@yoyaku/domain";
import {
  type AggregateAdapter,
  AggregateStore,
  type AppendOk,
  createEventStoreDb,
  type EventMetadata,
  type EventStoreDb,
  type IdempotencyContext,
  migrateEventStore,
  type NewEvent,
  type SnapshotPart,
  streams,
  withIdempotency,
} from "@yoyaku/event-store";
import { asc } from "drizzle-orm";
import { eventsAsOf } from "../lib/as-of";
import type { Bindings, ProjectionMessage } from "../types";
import { computeNextAlarm, OUTBOX_BACKSTOP_MS } from "./_shared/alarm";
import { type ArchiveResult, archiveAndPrune } from "./_shared/archive";
import { readEventsSince } from "./_shared/event-source";
import { flushOutboxWithBackstop, publishOutbox } from "./_shared/outbox";
import { HOLD_TTL_MS } from "./_shared/policy";
import type {
  BookInput,
  BookResult,
  ExecuteCommandResult,
  HoldInput,
  HoldResult,
  ReleaseInput,
  ReleaseResult,
  ShowingAsOfView,
  ShowingInfo,
} from "./_shared/rpc";
import { eventStoreErrorToHttp } from "./store-error";

/** ShowingState は Map を含むため snapshot 用に JSON 安全形へ(脱)シリアライズする。 */
type ShowingSnapshot = {
  status: ShowingState["status"];
  organizationId?: ShowingState["organizationId"];
  title?: string;
  startsAt?: number;
  venue?: string;
  salesStartAt?: number;
  salesEndAt?: number;
  currency?: string;
  totalSeats: number;
  riskTier: ShowingState["riskTier"];
  maxSeatsPerUser?: number;
  seats: [SeatId, SeatState][];
  holdsByUser: [UserId, number][];
};

function toShowingSnapshot(s: ShowingState): ShowingSnapshot {
  return {
    status: s.status,
    organizationId: s.organizationId,
    title: s.title,
    startsAt: s.startsAt,
    venue: s.venue,
    salesStartAt: s.salesStartAt,
    salesEndAt: s.salesEndAt,
    currency: s.currency,
    totalSeats: s.totalSeats,
    riskTier: s.riskTier,
    maxSeatsPerUser: s.maxSeatsPerUser,
    seats: [...s.seats.entries()],
    holdsByUser: [...s.holdsByUser.entries()],
  };
}

function fromShowingSnapshot(state: unknown): ShowingState {
  const o = state as ShowingSnapshot;
  return {
    status: o.status,
    organizationId: o.organizationId,
    title: o.title,
    startsAt: o.startsAt,
    venue: o.venue,
    salesStartAt: o.salesStartAt,
    salesEndAt: o.salesEndAt,
    currency: o.currency,
    totalSeats: o.totalSeats,
    riskTier: o.riskTier ?? "general",
    maxSeatsPerUser: o.maxSeatsPerUser,
    seats: new Map(o.seats),
    holdsByUser: new Map(o.holdsByUser),
  };
}

const showingAdapter: AggregateAdapter<ShowingState> = {
  initialState: initialShowingState,
  evolve: (s, payload) => showingDecider.evolve(s, payload as ShowingEvent),
  toSnapshotParts: (s) => [{ part: "full", state: toShowingSnapshot(s) }],
  fromSnapshotParts: (parts: SnapshotPart[]) => {
    const first = parts[0];
    return first ? fromShowingSnapshot(first.state) : undefined;
  },
};

/**
 * Showing 集約 = 1 Durable Object。単一ライターで二重予約を構造的に防止。
 * イベントストアは DO 内 SQLite（@yoyaku/event-store）。
 */
export class ShowingDO extends DurableObject<Bindings> {
  private store: EventStoreDb;
  private aggregateId: string;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.store = createEventStoreDb(ctx.storage);
    // fallback はローカル互換用。既存 stream があれば streams.aggregate_id を正本 ID として優先する。
    this.aggregateId = ctx.id.name ?? ctx.id.toString();
    ctx.blockConcurrencyWhile(() => migrateEventStore(this.store));
  }

  private aggregateFor(
    expectedAggregateId?: string,
  ): AggregateStore<ShowingState> {
    const stream = this.store
      .select({ aggregateId: streams.aggregateId })
      .from(streams)
      .orderBy(asc(streams.createdAt))
      .limit(1)
      .get();
    const aggregateId =
      stream?.aggregateId ?? expectedAggregateId ?? this.aggregateId;
    this.aggregateId = aggregateId;
    return new AggregateStore(
      this.store,
      this.ctx.storage,
      "Showing",
      aggregateId,
      showingAdapter,
    );
  }

  /**
   * コマンド実行: load(snapshot+差分) → decide → 原子追記(events/outboxes/streams) → snapshot。
   * 違反は decide が DomainError(409) を throw。楽観衝突など store 失敗は 409/500 に変換。
   * idem を渡すと「少なくとも1回配信/再試行下でも一度だけ」適用（FR-25/28）。Queue publish は Phase 02。
   */
  async execute(
    command: ShowingCommand,
    meta: EventMetadata,
    idem?: IdempotencyContext,
    expectedAggregateId?: string,
  ): Promise<AppendOk> {
    const aggregate = this.aggregateFor(expectedAggregateId);
    // recordSuccess は commit の同一 Tx 内で呼ばれ、冪等 succeeded 行を events と原子的に書く（FR-28）。
    const runOnce = (recordSuccess?: (ok: AppendOk) => void): AppendOk => {
      const { state, version } = aggregate.load();
      const newEvents = showingDecider.decide(command, state); // 違反は DomainError
      if (newEvents.length === 0) {
        // 冪等 no-op（§1 で冪等化された再発行など）。append せず head 据え置き。
        return { fromSeq: version + 1, toSeq: version, eventIds: [] };
      }
      const occurredAt = Date.now();
      const stored: NewEvent[] = newEvents.map((e) => ({
        eventType: e.type,
        payload: e,
        occurredAt,
      }));
      const committed = aggregate.commit(
        version,
        stored,
        meta,
        [],
        recordSuccess,
      );
      if (committed.type === "err")
        throw eventStoreErrorToHttp(committed.error);
      const newState = newEvents.reduce(showingDecider.evolve, state);
      aggregate.maybeSnapshot(committed.value.toSeq, newState);
      // publishOutbox()（インライン publish＋alarm backstop）は Phase 02。
      return committed.value;
    };

    let value: AppendOk;
    if (idem) {
      const res = withIdempotency<AppendOk>(this.store, idem, (rec) =>
        runOnce(rec),
      );
      if (res.type === "err") throw eventStoreErrorToHttp(res.error);
      value = res.value;
    } else {
      value = runOnce();
    }
    // コミット直後にインライン publish（失敗時のみ alarm backstop・§1.1）。
    await flushOutboxWithBackstop(
      this.store,
      this.env.PROJECTION_QUEUE,
      this.ctx.storage,
      Date.now(),
    );
    return value;
  }

  /** Route からの管理コマンド用 RPC。DomainError を structured-clone 可能な Result DTO で返す。 */
  async executeCommand(
    command: ShowingCommand,
    meta: EventMetadata,
    idem?: IdempotencyContext,
    aggregateId?: string,
  ): Promise<ExecuteCommandResult> {
    try {
      const value = await this.execute(command, meta, idem, aggregateId);
      return { ok: true, value };
    } catch (e) {
      return this.toRpcErr(e);
    }
  }

  /** 再投影/監査用: events を seq > given で昇順返却（consumer の能動 backfill・§4）。 */
  async getEventsSince(seq: number): Promise<ProjectionMessage[]> {
    return readEventsSince(this.store, seq);
  }

  /** 古い events を R2 退避＋プルーン（容量対策・Phase 10・NFR-14/16）。snapshot 未確立なら no-op。 */
  async archiveOldEvents(): Promise<ArchiveResult> {
    this.aggregateFor();
    return archiveAndPrune(
      this.store,
      this.ctx.storage,
      this.env.EVENT_ARCHIVE,
      "Showing",
      this.aggregateId,
    );
  }

  /**
   * as-of 状態再現（FR-23/24・§5）。`occurred_at <= asOf` のイベントを seq 昇順で decider 再生し、
   * その時点の座席状態（残席/確保/確定の件数）と公演ステータスを返す（管理/分析用・Phase 10 と統合）。
   */
  async replayAsOf(asOf: number): Promise<ShowingAsOfView> {
    const upTo = eventsAsOf(readEventsSince(this.store, 0), asOf);
    let state = initialShowingState();
    for (const m of upTo) {
      state = showingDecider.evolve(state, m.payload as ShowingEvent);
    }
    let availableSeats = 0;
    let heldSeats = 0;
    let bookedSeats = 0;
    for (const seat of state.seats.values()) {
      if (seat.status === "Available") availableSeats++;
      else if (seat.status === "Held") heldSeats++;
      else bookedSeats++;
    }
    return {
      asOf,
      status: state.status,
      totalSeats: state.totalSeats,
      availableSeats,
      heldSeats,
      bookedSeats,
    };
  }

  /**
   * RBAC 解決の正本（read model ラグを避けるため DO 状態から直接返す）。
   * route の `requireOrgRole(:id)` リゾルバが参照する。
   */
  async getInfo(): Promise<ShowingInfo> {
    const { state } = this.aggregateFor().load();
    return {
      status: state.status,
      organizationId: state.organizationId ?? null,
      riskTier: state.riskTier,
      maxSeatsPerUser: state.maxSeatsPerUser ?? null,
    };
  }

  /** DomainError を RpcErr DTO へ（その他は再 throw）。 */
  private toRpcErr(e: unknown) {
    if (e instanceof DomainError) {
      return {
        ok: false as const,
        code: e.code,
        httpStatus: e.httpStatus,
        message: e.message,
      };
    }
    throw e;
  }

  /**
   * 座席確保（Reservation DO からの RPC）。HoldSeats を直列実行し二重予約を構造的に防止（NFR-01/FR-12）。
   * holdExpiresAt = requestedAt + HOLD_TTL_MS（10 分）。requestedAt は販売期間ガード（BR-04）にも使う。
   * 競合/上限/期間外は decide が DomainError を throw → DTO（ok:false）に変換して返す（§5・DO 越し伝播）。
   */
  async hold(input: HoldInput, meta: EventMetadata): Promise<HoldResult> {
    const holdExpiresAt = input.requestedAt + HOLD_TTL_MS;
    const command: ShowingCommand = {
      type: "HoldSeats",
      reservationId: asReservationId(input.reservationId),
      userId: asUserId(input.userId),
      seatIds: input.seatIds.map(asSeatId),
      holdExpiresAt,
      requestedAt: input.requestedAt,
      maxSeatsPerUser: input.maxSeatsPerUser,
    };
    try {
      await this.execute(command, meta);
      return { ok: true, holdExpiresAt };
    } catch (e) {
      if (e instanceof DomainError) {
        return {
          ok: false,
          code: e.code,
          httpStatus: e.httpStatus,
          message: e.message,
        };
      }
      throw e;
    }
  }

  /**
   * 座席確定（Reservation DO の `captured⇒booked`・§4.1）。当該 reservationId が Held 中の席を Booked に。
   * BookSeats は冪等（既に Booked なら no-op・Phase 00 §1.3）＝キャプチャ後に何度再駆動しても安全。
   */
  async book(input: BookInput, meta: EventMetadata): Promise<BookResult> {
    const command: ShowingCommand = {
      type: "BookSeats",
      reservationId: asReservationId(input.reservationId),
      userId: asUserId(input.userId),
      seatIds: input.seatIds.map(asSeatId),
    };
    try {
      await this.execute(command, meta);
      return { ok: true };
    } catch (e) {
      if (e instanceof DomainError) {
        return {
          ok: false,
          code: e.code,
          httpStatus: e.httpStatus,
          message: e.message,
        };
      }
      throw e;
    }
  }

  /**
   * 座席解放（Reservation DO の補償 RPC・§3）。当該 reservationId が Held 中の席のみ解放（BR-07/08）。
   * ReleaseSeats は冪等（該当なしは no-op）＝再駆動で二重解放しても結果不変。本人以外の席は触れない。
   */
  async release(
    input: ReleaseInput,
    meta: EventMetadata,
  ): Promise<ReleaseResult> {
    const command: ShowingCommand = {
      type: "ReleaseSeats",
      reservationId: asReservationId(input.reservationId),
      userId: asUserId(input.userId),
      seatIds: input.seatIds.map(asSeatId),
      cause: input.cause,
    };
    try {
      await this.execute(command, meta);
      return { ok: true };
    } catch (e) {
      if (e instanceof DomainError) {
        return {
          ok: false,
          code: e.code,
          httpStatus: e.httpStatus,
          message: e.message,
        };
      }
      throw e;
    }
  }

  /** outbox 再送 backstop（Showing は通常 alarm 不要。送信失敗時のみ起動）。 */
  override async alarm(): Promise<void> {
    const { remaining } = await publishOutbox(
      this.store,
      this.env.PROJECTION_QUEUE,
    ).catch(() => ({ remaining: 1 }));
    const next = computeNextAlarm({
      now: Date.now(),
      outboxRemaining: remaining,
      backstopDelayMs: OUTBOX_BACKSTOP_MS,
    });
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}
