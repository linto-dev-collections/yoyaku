import { DurableObject } from "cloudflare:workers";
import {
  asOrgId,
  asSeatId,
  asShowingId,
  asUserId,
  DomainError,
  initialReservationState,
  isExpirable,
  type ReservationCommand,
  type ReservationEvent,
  type ReservationState,
  type ReservationStatus,
  reservationDecider,
} from "@yoyaku/domain";
import {
  type AggregateAdapter,
  AggregateStore,
  type AppendOk,
  bumpEffectAttemptSync,
  createEventStoreDb,
  type EventMetadata,
  type EventStoreDb,
  type IdempotencyContext,
  listPendingEffects,
  markEffectDoneSync,
  migrateEventStore,
  type NewEvent,
  type NewPendingEffect,
  type PendingEffectRow,
  type SnapshotPart,
  streams,
  withIdempotency,
} from "@yoyaku/event-store";
import { asc } from "drizzle-orm";
import { createStripe } from "../infrastructure/stripe/client";
import { structuredLog } from "../lib/observability";
import type { Bindings, ProjectionMessage } from "../types";
import { computeNextAlarm, OUTBOX_BACKSTOP_MS } from "./_shared/alarm";
import { type ArchiveResult, archiveAndPrune } from "./_shared/archive";
import { readEventsSince } from "./_shared/event-source";
import {
  countPendingOutbox,
  flushOutboxWithBackstop,
  publishOutbox,
} from "./_shared/outbox";
import { MAX_EFFECT_ATTEMPTS, MAX_SEATS_PER_USER } from "./_shared/policy";
import type {
  AttachPaymentIntentInput,
  AttachPaymentIntentResult,
  AuthorizeInput,
  AuthorizeResult,
  CancelInput,
  CancelResult,
  CaptureResult,
  HoldResult,
  ReleaseCause,
  ReservationView,
  RpcErr,
  ShowingStub,
  StartInput,
  StartResult,
} from "./_shared/rpc";
import { eventStoreErrorToHttp } from "./store-error";

/** ドメイン状態（PascalCase）→ API/read model 状態（snake_case）。view() で使用。 */
const STATUS_TO_API: Record<ReservationStatus, string> = {
  None: "none",
  Initiated: "initiated",
  AwaitingPayment: "awaiting_payment",
  Authorized: "authorized",
  Capturing: "capturing",
  Confirmed: "confirmed",
  Cancelled: "cancelled",
  Expired: "expired",
  PaymentFailed: "payment_failed",
  Failed: "failed",
};

// ReservationState は JSON 安全（Map なし）。snapshot は full 単一 part でそのまま保存。
const reservationAdapter: AggregateAdapter<ReservationState> = {
  initialState: initialReservationState,
  evolve: (s, payload) =>
    reservationDecider.evolve(s, payload as ReservationEvent),
  toSnapshotParts: (s) => [{ part: "full", state: s }],
  fromSnapshotParts: (parts: SnapshotPart[]) => {
    const first = parts[0];
    return first ? (first.state as ReservationState) : undefined;
  },
};

/**
 * Reservation 集約 = 1 Durable Object（購入プロセスのプロセスマネージャ）。
 * hold 期限を単一 alarm で管理（1 予約 1 alarm）。Showing/Payment を跨ぐ結果整合を調停。
 */
export class ReservationDO extends DurableObject<Bindings> {
  private store: EventStoreDb;
  private aggregateId: string;
  private aggregate: AggregateStore<ReservationState>;

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    this.store = createEventStoreDb(ctx.storage);
    // fallback はローカル互換用。既存 stream があれば streams.aggregate_id を正本 ID として優先する。
    this.aggregateId = ctx.id.name ?? ctx.id.toString();
    this.aggregate = new AggregateStore(
      this.store,
      ctx.storage,
      "Reservation",
      this.aggregateId,
      reservationAdapter,
    );
    ctx.blockConcurrencyWhile(async () => {
      await migrateEventStore(this.store);
      // クラッシュ後の未完効果（hold/release）があれば alarm を仕込み、alarm() 文脈で冪等再駆動する
      // （構築中の DO 間 RPC を避ける）。既存 alarm（hold 失効）があればそれが先に発火して回収する。
      if (listPendingEffects(this.store).length > 0) {
        const current = await ctx.storage.getAlarm();
        if (current === null) await ctx.storage.setAlarm(Date.now() + 1);
      }
    });
  }

  private aggregateFor(
    expectedAggregateId?: string,
  ): AggregateStore<ReservationState> {
    const stream = this.store
      .select({ aggregateId: streams.aggregateId })
      .from(streams)
      .orderBy(asc(streams.createdAt))
      .limit(1)
      .get();
    const aggregateId =
      stream?.aggregateId ?? expectedAggregateId ?? this.aggregateId;
    if (aggregateId !== this.aggregateId) {
      this.aggregateId = aggregateId;
      this.aggregate = new AggregateStore(
        this.store,
        this.ctx.storage,
        "Reservation",
        aggregateId,
        reservationAdapter,
      );
    }
    return this.aggregate;
  }

  /**
   * コマンド実行: load → decide → 原子追記（必要なら pending_effects も同一 Tx）→ snapshot。
   * Saga 副作用（HoldSeats/Stripe 等）は route/DO 層が pending_effects を介して起こす（Phase 04〜06）。
   */
  async execute(
    command: ReservationCommand,
    meta: EventMetadata,
    idem?: IdempotencyContext,
    pendingEffects: NewPendingEffect[] = [],
    expectedAggregateId?: string,
  ): Promise<AppendOk> {
    const aggregate = this.aggregateFor(expectedAggregateId);
    // recordSuccess は commit の同一 Tx 内で呼ばれ、冪等 succeeded 行を events と原子的に書く（FR-28）。
    const runOnce = (recordSuccess?: (ok: AppendOk) => void): AppendOk => {
      const { state, version } = aggregate.load();
      const newEvents = reservationDecider.decide(command, state);
      if (newEvents.length === 0) {
        return { fromSeq: version + 1, toSeq: version, eventIds: [] };
      }
      const occurredAt = Date.now();
      const stored: NewEvent[] = newEvents.map((e) => ({
        eventType: e.type,
        payload: e,
        occurredAt,
      }));
      // Saga 効果（hold 等）は events と同一 Tx で pending 記録（中断復旧の土台・§3.1）。
      const committed = aggregate.commit(
        version,
        stored,
        meta,
        pendingEffects,
        recordSuccess,
      );
      if (committed.type === "err")
        throw eventStoreErrorToHttp(committed.error);
      const newState = newEvents.reduce(reservationDecider.evolve, state);
      aggregate.maybeSnapshot(committed.value.toSeq, newState);
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
    await flushOutboxWithBackstop(
      this.store,
      this.env.PROJECTION_QUEUE,
      this.ctx.storage,
      Date.now(),
    );
    return value;
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
      "Reservation",
      this.aggregateId,
    );
  }

  /**
   * 予約開始 Saga（route からの RPC・§3）。価格固定で ReservationInitiated を記録し、
   * Showing DO に HoldSeats を依頼して結果を統合する。状態機械で再入冪等:
   *  - None        → initiate（ReservationInitiated＋pending hold を同一Tx）→ hold 駆動
   *  - Initiated   → hold 再駆動（中断復旧。HoldSeats は冪等 no-op）
   *  - AwaitingPay → 既存 holdExpiresAt を返す（再試行）
   *  - Failed/他   → 失敗を返す（同一失敗の再現）
   */
  async start(input: StartInput, meta: EventMetadata): Promise<StartResult> {
    const result = await this.startInner(input, meta);
    // hold 成功で holdExpiresAt の alarm を設定（outbox backstop と多重化）。
    await this.rearmAlarm();
    return result;
  }

  private async startInner(
    input: StartInput,
    meta: EventMetadata,
  ): Promise<StartResult> {
    const { state } = this.aggregateFor(input.reservationId).load();
    if (state.status === "AwaitingPayment") {
      return { ok: true, holdExpiresAt: state.holdExpiresAt ?? 0 };
    }
    if (state.status === "Failed") {
      return {
        ok: false,
        code: "seat_conflict",
        httpStatus: 409,
        message: "reservation previously failed to hold seats",
      };
    }
    if (state.status === "None") {
      await this.execute(
        {
          type: "StartReservation",
          userId: asUserId(input.userId),
          showingId: asShowingId(input.showingId),
          organizationId: asOrgId(input.organizationId),
          seatIds: input.seatIds.map(asSeatId),
          pricing: input.pricing,
        },
        meta,
        undefined,
        [
          {
            effectId: this.holdEffectId(),
            kind: "hold",
            payload: {
              showingId: input.showingId,
              userId: input.userId,
              seatIds: input.seatIds,
            },
          },
        ],
        input.reservationId,
      );
    } else if (state.status !== "Initiated") {
      return {
        ok: false,
        code: "invalid_state",
        httpStatus: 409,
        message: `cannot start reservation in status ${state.status}`,
      };
    }
    return this.driveHold(meta);
  }

  private holdEffectId(): string {
    return `hold:${this.aggregateId}`;
  }

  /**
   * Showing へ HoldSeats を発行し、結果を Reservation に統合する（冪等・§3.1）。
   * 成功 → ReservationHeld、競合/上限/期間外 → ReservationFailed。pending hold を done に。
   */
  private async driveHold(meta: EventMetadata): Promise<StartResult> {
    const { state } = this.aggregateFor().load();
    if (state.status === "AwaitingPayment") {
      return { ok: true, holdExpiresAt: state.holdExpiresAt ?? 0 };
    }
    if (state.status !== "Initiated" || !state.showingId || !state.userId) {
      return {
        ok: false,
        code: "invalid_state",
        httpStatus: 409,
        message: "reservation is not awaiting a hold",
      };
    }

    const showing = this.env.SHOWING.getByName(
      state.showingId,
    ) as unknown as ShowingStub;
    const holdMeta: EventMetadata = {
      correlationId: meta.correlationId,
      causationId: this.aggregateId,
      actor: state.userId,
    };
    // RPC の一時障害（throw）は他 drive（release/book/void）と対称に握り、hold 効果を done にせず
    // pending 据え置きのまま 503 を返す（次回 alarm 再駆動で収束）。res.ok===false（席競合/上限＝
    // 確定的拒否）は従来どおり MarkHoldRejected→ReservationFailed でイベント化する。
    let res: HoldResult;
    try {
      res = await showing.hold(
        {
          reservationId: this.aggregateId,
          userId: state.userId,
          seatIds: state.seatIds,
          requestedAt: Date.now(),
          maxSeatsPerUser: MAX_SEATS_PER_USER,
        },
        holdMeta,
      );
    } catch {
      return {
        ok: false,
        code: "hold_unavailable",
        httpStatus: 503,
        message: "hold temporarily unavailable, will retry",
      };
    }

    if (res.ok) {
      await this.execute(
        { type: "MarkHeld", holdExpiresAt: res.holdExpiresAt },
        meta,
      );
      this.markEffectDone(this.holdEffectId());
      return { ok: true, holdExpiresAt: res.holdExpiresAt };
    }
    await this.execute({ type: "MarkHoldRejected", reason: res.code }, meta);
    this.markEffectDone(this.holdEffectId());
    return res;
  }

  // ---- 取消・照会（route からの RPC・§4/§6） --------------------------------

  /**
   * 取消（DELETE /reservations/:id）。本人検証（BR-13）後、確保中のみ取消可。
   * 確定後は invalid_state(409)（BR-03）。冪等（既に取消/失効/失敗なら 204 相当の no-op）。
   */
  async cancel(input: CancelInput, meta: EventMetadata): Promise<CancelResult> {
    const { state } = this.aggregateFor().load();
    if (state.status === "None") {
      return { ok: false, code: "not_found", httpStatus: 404 };
    }
    if (state.userId !== input.requestedBy) {
      return {
        ok: false,
        code: "forbidden",
        httpStatus: 403,
        message: "not your reservation",
      };
    }
    try {
      await this.terminate({ type: "Cancel" }, "cancelled", meta);
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
    await this.redrivePendingEffects();
    await this.rearmAlarm();
    return { ok: true };
  }

  /** 現在状態のビュー（read-your-writes・FR-21）。本人検証は route 側で userId 照合。 */
  async view(): Promise<ReservationView | null> {
    const { state } = this.aggregateFor().load();
    if (state.status === "None") return null;
    return {
      reservationId: this.aggregateId,
      userId: state.userId ?? null,
      showingId: state.showingId ?? null,
      organizationId: state.organizationId ?? null,
      status: STATUS_TO_API[state.status],
      seatIds: state.seatIds,
      pricing: state.pricing ?? null,
      holdExpiresAt: state.holdExpiresAt ?? null,
      paymentIntentId: state.paymentIntentId ?? null,
    };
  }

  // ---- 決済（オーソリ/キャプチャ・§3/§4） ---------------------------------

  /**
   * PI 作成直後の paymentIntentId 記録（authorize ルートから・**与信 void 漏れ対策 FR-26/BR-11**）。
   * AwaitingPayment のときだけ ReservationPaymentPending を記録（status は不変）。冪等（同一 PI は no-op）。
   * これにより webhook(`amount_capturable_updated`→authorize) より先に確保失効しても、terminate が
   * `state.paymentIntentId` を見て void 効果を生成できる（席解放と同時に未キャプチャ与信を取り消す）。
   */
  async attachPaymentIntent(
    input: AttachPaymentIntentInput,
    meta: EventMetadata,
  ): Promise<AttachPaymentIntentResult> {
    try {
      await this.execute(
        { type: "AttachPaymentIntent", paymentIntentId: input.paymentIntentId },
        meta,
      );
    } catch (e) {
      return this.toRpcErr(e);
    }
    await this.rearmAlarm();
    return { ok: true };
  }

  /**
   * オーソリ確保の記録（webhook `amount_capturable_updated` 正本・§3.3）。
   * AwaitingPayment → ReservationAuthorized。既に Authorized/Confirmed なら冪等 no-op。
   * 経路（webhook/同期/照合）非依存で二重反映しても安全。
   */
  async authorize(
    input: AuthorizeInput,
    meta: EventMetadata,
  ): Promise<AuthorizeResult> {
    const { state } = this.aggregateFor().load();
    if (state.status === "Authorized" || state.status === "Confirmed") {
      return { ok: true };
    }
    if (state.status !== "AwaitingPayment") {
      return {
        ok: false,
        code: "invalid_state",
        httpStatus: 409,
        message: `cannot authorize in ${state.status}`,
      };
    }
    try {
      await this.execute(
        {
          type: "Authorize",
          paymentIntentId: input.paymentIntentId,
          amount: input.amount,
          applicationFeeAmount: input.applicationFeeAmount,
        },
        meta,
      );
    } catch (e) {
      return this.toRpcErr(e);
    }
    await this.rearmAlarm();
    return { ok: true };
  }

  /**
   * キャプチャ（route / webhook `succeeded` / 照合の統一入口）。**DO 所有の capture**:
   * Authorized なら先に `ReservationCaptureStarted`（Capturing＝**非失効**）＋`capture`(pending) を
   * 同一 Tx で記録し、その後 Stripe capture を DO 内で冪等駆動する。これにより route の外部 I/O 中に
   * hold 失効 alarm が走っても **席を解放しない**（capture×失効競合の「入金あり・席なし」を解消）。
   * クラッシュ/一時失敗は `capture` 効果の再駆動（alarm/webhook）で必ず確定する。確定済みは冪等 no-op。
   */
  async capture(meta: EventMetadata): Promise<CaptureResult> {
    const { state } = this.aggregateFor().load();
    if (state.status === "Confirmed") {
      await this.driveBook(); // 入金済み確定の book を冪等に保証
      return { ok: true };
    }
    if (state.status === "Authorized") {
      // capture 着手＝非失効化＋capture 効果を記録（Stripe capture の前に・同一 Tx）。
      try {
        await this.execute({ type: "BeginCapture" }, meta, undefined, [
          {
            effectId: this.captureEffectId(),
            kind: "capture",
            payload: { paymentIntentId: state.paymentIntentId ?? null },
          },
        ]);
      } catch (e) {
        return this.toRpcErr(e);
      }
    } else if (state.status !== "Capturing") {
      return {
        ok: false,
        code: "invalid_state",
        httpStatus: 409,
        message: `cannot capture in ${state.status}`,
      };
    }
    await this.driveCapture();
    await this.rearmAlarm();
    const after = this.aggregateFor().load().state;
    if (after.status === "Confirmed") return { ok: true };
    // Stripe capture が一時的に未完（要再試行）。capture 効果は pending のまま＝alarm/webhook で収束。
    return {
      ok: false,
      code: "capture_pending",
      httpStatus: 409,
      message: "capture is being processed",
    };
  }

  /** DomainError を RpcErr DTO へ（その他は再 throw）。 */
  private toRpcErr(e: unknown): RpcErr {
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

  // ---- 補償・失効・再駆動（§2/§3） -----------------------------------------

  private releaseEffectId(): string {
    return `release:${this.aggregateId}`;
  }

  private bookEffectId(): string {
    return `book:${this.aggregateId}`;
  }

  private captureEffectId(): string {
    return `capture:${this.aggregateId}`;
  }

  private voidEffectId(): string {
    return `void:${this.aggregateId}`;
  }

  private systemMeta(): EventMetadata {
    return {
      correlationId: this.aggregateId,
      causationId: this.aggregateId,
      actor: "system",
    };
  }

  /** pending 効果を done に（効果の RPC 成功後・自己修復のため別 Tx で可）。 */
  private markEffectDone(effectId: string): void {
    this.ctx.storage.transactionSync(() =>
      markEffectDoneSync(this.store, effectId),
    );
  }

  /**
   * 終端イベント（Expire/Cancel）を append し、同一 Tx で `release`(pending) を記録する（§3.1）。
   * 実際の Showing `ReleaseSeats` RPC は redrivePendingEffects() が冪等に駆動する（中断復旧と同経路）。
   * Cancel は確定後 invalid_state(409) を throw しうる（呼び出し側が捕捉）。
   */
  private async terminate(
    command: { type: "Expire" } | { type: "Cancel" },
    cause: ReleaseCause,
    meta: EventMetadata,
  ): Promise<void> {
    const { state } = this.aggregateFor().load();
    const effects: NewPendingEffect[] = [
      {
        effectId: this.releaseEffectId(),
        kind: "release",
        payload: {
          showingId: state.showingId ?? null,
          userId: state.userId ?? null,
          seatIds: state.seatIds,
          cause,
        },
      },
    ];
    // オーソリ済み（requires_capture）の PI があれば与信 void も補償する（FR-26）。
    if (state.paymentIntentId) {
      effects.push({
        effectId: this.voidEffectId(),
        kind: "void",
        payload: { paymentIntentId: state.paymentIntentId },
      });
    }
    await this.execute(command, meta, undefined, effects);
  }

  /** 期限到来かつ未確定なら Expire（→補償で席解放）。冪等（isExpirable で終端は no-op）。 */
  private async evaluateHoldExpiry(): Promise<void> {
    const { state } = this.aggregateFor().load();
    if (!isExpirable(state.status) || state.holdExpiresAt == null) return;
    if (Date.now() < state.holdExpiresAt) return; // まだ期限内 → rearm で再設定
    await this.terminate({ type: "Expire" }, "expired", this.systemMeta());
  }

  /**
   * 未 done の pending_effects を冪等に再駆動する（指摘 1 の中断復旧・NFR-03）。
   * hold → driveHold、release → Showing `ReleaseSeats`、book → Showing `BookSeats`、void → Stripe cancel。
   * いずれも冪等のため何度再駆動しても安全（`captured⇒booked`・`released`・`voided` を必ず収束）。
   */
  private async redrivePendingEffects(): Promise<void> {
    for (const effect of listPendingEffects(this.store)) {
      // 試行回数を計上（観測・恒久失敗検知の土台）。閾値超過は構造化ログで escalate するが、
      // **再駆動は止めない**（収束を諦めない。打ち切りはせず Workers Logs→アラートで可視化）。
      this.bumpEffectAttempt(effect.effectId);
      const attempts = effect.attempts + 1;
      if (attempts >= MAX_EFFECT_ATTEMPTS) {
        console.log(
          structuredLog("error", "pending_effect_stuck", {
            reservationId: this.aggregateId,
            effectId: effect.effectId,
            kind: effect.kind,
            attempts,
          }),
        );
      }
      if (effect.kind === "release") await this.driveRelease(effect);
      else if (effect.kind === "hold") await this.driveHoldRedrive(effect);
      else if (effect.kind === "capture") await this.driveCapture();
      else if (effect.kind === "book") await this.driveBook();
      else if (effect.kind === "void") await this.driveVoid(effect);
    }
  }

  /** 効果の試行回数を +1（markEffectDone と同様に storage Tx で包む）。 */
  private bumpEffectAttempt(effectId: string): void {
    this.ctx.storage.transactionSync(() =>
      bumpEffectAttemptSync(this.store, effectId),
    );
  }

  /**
   * `capture` 効果（§4.1・指摘: capture×失効競合）。Capturing 中に Stripe を **DO 内で**冪等 capture し、
   * 成功で ReservationConfirmed＋`book`(pending) を記録して Showing `BookSeats` を駆動する。一時失敗は
   * 効果据え置き → alarm/webhook 再駆動で必ず確定（idempotencyKey で二重 capture を防止）。
   */
  private async driveCapture(): Promise<void> {
    const { state } = this.aggregateFor().load();
    if (state.status !== "Capturing" || !state.paymentIntentId) return;
    const stripe = createStripe(this.env.STRIPE_SECRET_KEY);
    let pi: Awaited<ReturnType<typeof stripe.paymentIntents.retrieve>>;
    try {
      pi = await stripe.paymentIntents.capture(
        state.paymentIntentId,
        undefined,
        {
          idempotencyKey: `${this.aggregateId}:capture`,
        },
      );
    } catch {
      // capture 呼出が失敗（一時障害、または idem キー外で既に succeeded＝別経路 capture 済み等）。
      // 現在の PI 状態を確認し、succeeded なら確定へ進む。未確定/取得失敗は再駆動に委ねる。
      try {
        pi = await stripe.paymentIntents.retrieve(state.paymentIntentId);
      } catch {
        return; // 一時失敗（ネットワーク等）→ pending 据え置きで再駆動
      }
    }
    if (pi.status !== "succeeded") return; // まだ未確定 → 再駆動に委ねる
    try {
      await this.execute(
        {
          type: "Capture",
          capturedAmount: pi.amount_received,
          currency: pi.currency.toUpperCase(),
          capturedAt: Date.now(),
        },
        this.systemMeta(),
        undefined,
        [
          {
            effectId: this.bookEffectId(),
            kind: "book",
            payload: {
              showingId: state.showingId ?? null,
              userId: state.userId ?? null,
              seatIds: state.seatIds,
            },
          },
        ],
      );
    } catch {
      // amount_mismatch 等（固定額不一致＝要調査）。capture 効果は done にして照合ジョブへ委ねる
      // （doomed な再 capture ループを避ける。入金額の乖離は recon が検出・是正）。
      this.markEffectDone(this.captureEffectId());
      return;
    }
    this.markEffectDone(this.captureEffectId());
    await this.driveBook();
  }

  /**
   * `captured⇒booked`（§4.1）。確定済み予約の Held 席を Showing `BookSeats`（冪等）で Booked に。
   * 成功で `book` 効果を done に。失敗は pending 据え置き → alarm/起動で再駆動（入金済みのため必ず確定）。
   */
  private async driveBook(): Promise<void> {
    const { state } = this.aggregateFor().load();
    if (
      state.status !== "Confirmed" ||
      !state.showingId ||
      !state.userId ||
      state.seatIds.length === 0
    ) {
      return;
    }
    const showing = this.env.SHOWING.getByName(
      state.showingId,
    ) as unknown as ShowingStub;
    const res = await showing.book(
      {
        reservationId: this.aggregateId,
        userId: state.userId,
        seatIds: state.seatIds,
      },
      this.systemMeta(),
    );
    if (res.ok) this.markEffectDone(this.bookEffectId());
  }

  /**
   * 与信 void（§6）。requires_capture の PI を cancel。既にキャンセル/確定済み（cancelable でない）は
   * 冪等に done 扱い、ネットワーク等の一時失敗は pending 据え置きで再駆動。
   */
  private async driveVoid(effect: PendingEffectRow): Promise<void> {
    const p = effect.payload as { paymentIntentId: string | null };
    if (p.paymentIntentId) {
      const stripe = createStripe(this.env.STRIPE_SECRET_KEY);
      try {
        await stripe.paymentIntents.cancel(p.paymentIntentId, undefined, {
          idempotencyKey: `${this.aggregateId}:void`,
        });
      } catch (e) {
        // 4xx（PI が cancelable でない＝既に取消/確定）は冪等に done。その他は再駆動に委ねる。
        const type = (e as { type?: string }).type;
        if (type !== "StripeInvalidRequestError") return;
      }
    }
    this.markEffectDone(effect.effectId);
  }

  private async driveRelease(effect: PendingEffectRow): Promise<void> {
    const p = effect.payload as {
      showingId: string | null;
      userId: string | null;
      seatIds: string[];
      cause: ReleaseCause;
    };
    if (p.showingId && p.userId && p.seatIds.length > 0) {
      const showing = this.env.SHOWING.getByName(
        p.showingId,
      ) as unknown as ShowingStub;
      const res = await showing.release(
        {
          reservationId: this.aggregateId,
          userId: p.userId,
          seatIds: p.seatIds,
          cause: p.cause,
        },
        this.systemMeta(),
      );
      if (!res.ok) return; // 失敗は pending 据え置き → 次回 alarm/起動で再駆動
    }
    this.markEffectDone(effect.effectId);
  }

  private async driveHoldRedrive(effect: PendingEffectRow): Promise<void> {
    const { state } = this.aggregateFor().load();
    if (state.status === "Initiated") {
      await this.driveHold(this.systemMeta()); // 内部で hold 効果を done に
    } else {
      this.markEffectDone(effect.effectId); // 既に hold 解決済み → 効果を回収
    }
  }

  /**
   * 次回 alarm を再設定（authoritative・§2）。hold 失効と「未完作業の backstop」を多重化:
   * min(holdExpiresAt（失効対象時のみ）, now+backstop（outbox 未送 or 未完効果が残る時のみ）)。
   * 未完作業が残る限り backstop を張り続けるため、補償 RPC 失敗も次回再駆動で必ず収束する（NFR-03）。
   */
  private async rearmAlarm(): Promise<void> {
    const { state } = this.aggregateFor().load();
    const holdExpiresAt = isExpirable(state.status)
      ? (state.holdExpiresAt ?? null)
      : null;
    const pendingWork =
      countPendingOutbox(this.store) > 0 ||
      listPendingEffects(this.store).length > 0;
    const next = computeNextAlarm({
      now: Date.now(),
      outboxRemaining: pendingWork ? 1 : 0,
      backstopDelayMs: OUTBOX_BACKSTOP_MS,
      holdExpiresAt,
    });
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  /**
   * 単一 alarm の多重化ハンドラ（§2）: outbox 再送 → 失効評価（Expire）→ 未完効果の冪等再駆動 → 再 arm。
   * at-least-once / 最大6回バックオフ前提で、状態確認してから処理（冪等）。
   *
   * 堅牢性（NFR-03）: 各ステップを独立に隔離し、**いずれが throw しても最後の rearmAlarm を必ず実行**する。
   * これを怠ると 1 ステップの例外で次回 alarm を失い、DO の自己回復ウェイクアップが止まってしまう。
   * 失敗は構造化ログで可観測化（Workers Logs→アラート）。未完作業が残れば rearmAlarm が backstop を張り
   * 続けるため次回再駆動で収束する。rearmAlarm 自体の失敗は意図的に伝播させ、Cloudflare の alarm 自動
   * リトライを最終バックストップにする。
   */
  override async alarm(): Promise<void> {
    await this.runAlarmStep("publishOutbox", () =>
      publishOutbox(this.store, this.env.PROJECTION_QUEUE),
    );
    await this.runAlarmStep("evaluateHoldExpiry", () =>
      this.evaluateHoldExpiry(),
    );
    await this.runAlarmStep("redrivePendingEffects", () =>
      this.redrivePendingEffects(),
    );
    await this.rearmAlarm();
  }

  /** alarm の 1 ステップを隔離実行。例外は飲み込まず構造化ログに記録し、後続ステップと rearm を継続させる。 */
  private async runAlarmStep(
    step: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await run();
    } catch (e) {
      console.log(
        structuredLog("error", "alarm_step_failed", {
          reservationId: this.aggregateId,
          step,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }
}
