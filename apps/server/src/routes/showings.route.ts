import { zValidator } from "@hono/zod-validator";
import { db } from "@yoyaku/db";
import {
  salesDashboards,
  seatAvailabilities,
  showings,
} from "@yoyaku/db/schema";
import {
  asOrgId,
  asSeatId,
  asTicketTypeId,
  DomainError,
  type ShowingCommand,
} from "@yoyaku/domain";
import {
  computeRequestHash,
  type IdempotencyContext,
} from "@yoyaku/event-store";
import { asc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import {
  IMPORT_MAX_PAYLOAD_BYTES,
  IMPORT_MAX_SEATS_PER_REQUEST,
} from "../durable-objects/_shared/policy";
import type { ShowingStub } from "../durable-objects/_shared/rpc";
import { getConnectAccount } from "../lib/connect";
import { allocateCanonicalId } from "../lib/intake";
import { conversionRate, occupancyRate } from "../lib/sales";
import {
  getMemberRole,
  type OrgIdResolver,
  requireOrgRole,
} from "../middleware/rbac";
import type { AppEnv, Bindings } from "../types";
import { importSeatsSchema, registerShowingSchema } from "./schemas";

const IDEM_TTL_MS = 60 * 60 * 1000; // 1h

const idemKeyOf = (c: Context<AppEnv>): string =>
  c.req.header("Idempotency-Key") ?? crypto.randomUUID();

const buildIdem = async (
  key: string,
  commandType: string,
  actor: string,
  body: unknown,
): Promise<IdempotencyContext> => ({
  key,
  commandType,
  actor,
  requestHash: await computeRequestHash(body),
  ttlMs: IDEM_TTL_MS,
  now: Date.now(),
});

const stubFor = (env: Bindings, showingId: string): ShowingStub =>
  env.SHOWING.getByName(showingId) as unknown as ShowingStub;

async function executeShowingCommand(
  stub: ShowingStub,
  command: ShowingCommand,
  meta: { correlationId: string; actor: string },
  idem?: IdempotencyContext,
  aggregateId?: string,
) {
  const result = await stub.executeCommand(command, meta, idem, aggregateId);
  if (!result.ok) {
    throw new DomainError(
      result.code,
      result.httpStatus,
      result.message ?? result.code,
    );
  }
  return result.value;
}

async function resolveShowingOrgFromReadModel(
  id: string,
): Promise<string | null> {
  const row = await db
    .select({ organizationId: showings.organizationId })
    .from(showings)
    .where(eq(showings.showingId, id))
    .get();
  return row?.organizationId ?? null;
}

async function assertWritableShowing(stub: ShowingStub, id: string) {
  const info = await stub.getInfo();
  if (info.status !== "None") return info;
  const organizationId = await resolveShowingOrgFromReadModel(id);
  if (organizationId) {
    throw new DomainError(
      "showing_source_unavailable",
      409,
      "showing read model exists but source aggregate is unavailable; reset or repair local Durable Object data",
    );
  }
  throw new DomainError("not_found", 404, "showing not found");
}

/** :id 公演の組織を解決して RBAC を行うリゾルバ。DO が未復元/空の場合だけ D1 にフォールバックする。 */
const resolveShowingOrg: OrgIdResolver = async (c) => {
  const id = c.req.param("id");
  if (!id) return null;
  const info = await stubFor(c.env, id).getInfo();
  return info.organizationId ?? resolveShowingOrgFromReadModel(id);
};

/** sales 等の read-model 照会用。DO が未復元/空の場合だけ D1 にフォールバックする。 */
const resolveShowingOrgForRead: OrgIdResolver = async (c) => {
  const id = c.req.param("id");
  if (!id) return null;
  const info = await stubFor(c.env, id).getInfo();
  if (info.organizationId) return info.organizationId;
  return resolveShowingOrgFromReadModel(id);
};

/** Date カラム → epoch ms（API レスポンスの時刻表現を数値に統一・TZ 規約）。 */
const toMs = (d: Date | null): number | null =>
  d != null ? d.getTime() : null;

/** showings 行の時刻フィールドを epoch ms へ正規化。 */
const serializeShowing = (row: typeof showings.$inferSelect) => ({
  ...row,
  startsAt: toMs(row.startsAt),
  salesStartAt: toMs(row.salesStartAt),
  salesEndAt: toMs(row.salesEndAt),
  createdAt: toMs(row.createdAt),
  updatedAt: toMs(row.updatedAt),
});

/**
 * 公演（主催）と空席照会。command → intake(冪等ID) → Showing DO(append) の縦切り（§2）。
 * RBAC は @yoyaku/auth の Organization（admin 以上が公演管理）。照会は D1 read model。
 */
export const showingsRoute = new Hono<AppEnv>()
  // 公演登録（draft・ヘッダのみ）。intake で正準 showingId を払い出す。
  .post(
    "/",
    requireOrgRole("admin"),
    zValidator("json", registerShowingSchema, (r, c) => {
      if (!r.success)
        return c.json(
          { error: "invalid_request", issues: r.error.issues },
          422,
        );
    }),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const body = c.req.valid("json");

      const idemKey = idemKeyOf(c);
      const alloc = await allocateCanonicalId(
        c.env,
        idemKey,
        "RegisterShowing",
        body,
      );
      if (!alloc.ok)
        throw new DomainError(alloc.code, alloc.httpStatus, alloc.message);
      const showingId = alloc.canonicalId;

      const command: ShowingCommand = {
        type: "RegisterShowing",
        organizationId: asOrgId(body.organizationId),
        title: body.title,
        startsAt: body.startsAt,
        venue: body.venue,
        salesStartAt: body.salesStartAt,
        salesEndAt: body.salesEndAt,
        currency: body.currency,
        ticketTypes: body.ticketTypes.map((t) => ({
          ticketTypeId: asTicketTypeId(t.ticketTypeId),
          name: t.name,
          unitAmount: t.unitAmount,
          currency: t.currency,
        })),
        totalSeats: body.totalSeats,
        // 公平性/不正対策（Phase 09）。未指定は domain が general・上限 4 を確定。
        riskTier: body.riskTier,
        maxSeatsPerUser: body.maxSeatsPerUser,
      };
      const meta = { correlationId: crypto.randomUUID(), actor: user.id };
      const idem = await buildIdem(idemKey, "RegisterShowing", user.id, body);
      await executeShowingCommand(
        stubFor(c.env, showingId),
        command,
        meta,
        idem,
        showingId,
      );
      return c.json({ showingId }, 201);
    },
  )
  // 在庫投入（section チャンク）。envelope 込み 128KB 未満のため席数を制限。
  .post(
    "/:id/seats:import",
    requireOrgRole("admin", resolveShowingOrg),
    zValidator("json", importSeatsSchema, (r, c) => {
      if (!r.success)
        return c.json(
          { error: "invalid_request", issues: r.error.issues },
          422,
        );
    }),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.param("id");
      const body = c.req.valid("json");
      if (body.seats.length > IMPORT_MAX_SEATS_PER_REQUEST) {
        throw new DomainError(
          "payload_too_large",
          413,
          `import at most ${IMPORT_MAX_SEATS_PER_REQUEST} seats per request`,
        );
      }
      const command: ShowingCommand = {
        type: "ImportSeats",
        section: body.section,
        seats: body.seats.map((s) => ({
          seatId: asSeatId(s.seatId),
          rowLabel: s.rowLabel,
          seatNumber: s.seatNumber,
          ticketTypeId: asTicketTypeId(s.ticketTypeId),
        })),
      };
      // 実バイト数で 128KB を保証（Queue publish の恒久失敗＝投影停止を防ぐ・指摘4）。
      // SeatsImported event payload は本 command とほぼ同形。閾値超過は section を分割させる。
      const payloadBytes = new TextEncoder().encode(
        JSON.stringify(command),
      ).length;
      if (payloadBytes > IMPORT_MAX_PAYLOAD_BYTES) {
        throw new DomainError(
          "payload_too_large",
          413,
          `import payload ${payloadBytes}B exceeds ${IMPORT_MAX_PAYLOAD_BYTES}B; split the section into smaller chunks`,
        );
      }
      const meta = { correlationId: crypto.randomUUID(), actor: user.id };
      const idem = await buildIdem(idemKeyOf(c), "ImportSeats", user.id, body);
      const stub = stubFor(c.env, id);
      await assertWritableShowing(stub, id);
      await executeShowingCommand(stub, command, meta, idem, id);
      return c.json({ showingId: id, imported: body.seats.length }, 200);
    },
  )
  // 公開（draft → on_sale）。販売の前提は組織の Connect recipient transfer readiness（§2 公開ガード）。
  .post(
    "/:id/publish",
    requireOrgRole("admin", resolveShowingOrg),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.param("id");
      const orgId = c.get("activeOrganizationId");
      const connect = orgId ? await getConnectAccount(orgId) : null;
      if (!connect?.chargesEnabled) {
        throw new DomainError(
          "connect_not_ready",
          409,
          "complete Stripe Connect onboarding before publishing",
        );
      }
      const meta = { correlationId: crypto.randomUUID(), actor: user.id };
      const idem = await buildIdem(idemKeyOf(c), "PublishShowing", user.id, {
        id,
        command: "publish",
      });
      const stub = stubFor(c.env, id);
      await assertWritableShowing(stub, id);
      await executeShowingCommand(
        stub,
        { type: "PublishShowing" },
        meta,
        idem,
        id,
      );
      return c.json({ showingId: id, status: "on_sale" }, 200);
    },
  )
  // 非公開（on_sale → draft）。有効 hold 中の非公開可否はポリシー（未決・本フェーズは許可）。
  .post(
    "/:id/unpublish",
    requireOrgRole("admin", resolveShowingOrg),
    async (c) => {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.param("id");
      const raw = (await c.req.json().catch(() => ({}))) as {
        reason?: unknown;
      };
      const reason = typeof raw.reason === "string" ? raw.reason : undefined;
      const meta = { correlationId: crypto.randomUUID(), actor: user.id };
      const idem = await buildIdem(idemKeyOf(c), "UnpublishShowing", user.id, {
        id,
        reason: reason ?? null,
      });
      const stub = stubFor(c.env, id);
      await assertWritableShowing(stub, id);
      await executeShowingCommand(
        stub,
        { type: "UnpublishShowing", reason },
        meta,
        idem,
        id,
      );
      return c.json({ showingId: id, status: "draft" }, 200);
    },
  )
  // 一覧。既定は on_sale を誰でも。?organizationId= 指定時は組織メンバーのみ全 status。
  .get("/", async (c) => {
    const organizationId = c.req.query("organizationId");
    if (organizationId) {
      const user = c.get("user");
      if (!user) return c.json({ error: "unauthorized" }, 401);
      const role = await getMemberRole(user.id, organizationId);
      if (!role) return c.json({ error: "forbidden" }, 403);
      const rows = await db
        .select()
        .from(showings)
        .where(eq(showings.organizationId, organizationId))
        .orderBy(asc(showings.startsAt))
        .all();
      return c.json({ asOf: Date.now(), showings: rows.map(serializeShowing) });
    }
    const rows = await db
      .select()
      .from(showings)
      .where(eq(showings.status, "on_sale"))
      .orderBy(asc(showings.startsAt))
      .all();
    return c.json({ asOf: Date.now(), showings: rows.map(serializeShowing) });
  })
  // 空席マップ（座席表）。結果整合のため asOf（取得時刻）を併記（FR-21/37）。
  .get("/:id/seats", async (c) => {
    const id = c.req.param("id");
    const seats = await db
      .select({
        seatId: seatAvailabilities.seatId,
        section: seatAvailabilities.section,
        rowLabel: seatAvailabilities.rowLabel,
        seatNumber: seatAvailabilities.seatNumber,
        ticketTypeId: seatAvailabilities.ticketTypeId,
        status: seatAvailabilities.status,
        holdExpiresAt: seatAvailabilities.holdExpiresAt,
      })
      .from(seatAvailabilities)
      .where(eq(seatAvailabilities.showingId, id))
      .orderBy(asc(seatAvailabilities.seatId))
      .all();
    return c.json({
      asOf: Date.now(),
      showingId: id,
      seats: seats.map((s) => ({ ...s, holdExpiresAt: toMs(s.holdExpiresAt) })),
    });
  })
  // 売上ダッシュボード（FR-20）。組織メンバーのみ（BR-12）。残席/売上/稼働率/コンバージョンを返す。
  // sales は read model 照会なので、DO が空でも D1 の showings 行から組織を解決して閲覧可能にする。
  .get(
    "/:id/sales",
    requireOrgRole("member", resolveShowingOrgForRead),
    async (c) => {
      const id = c.req.param("id");
      const dash = await db
        .select()
        .from(salesDashboards)
        .where(eq(salesDashboards.showingId, id))
        .get();
      // 投影未到達（ラグ）でも 200＋ゼロ値＋asOf（結果整合の明示・FR-37）。
      if (!dash) {
        return c.json({
          showingId: id,
          organizationId: c.get("activeOrganizationId"),
          totalSeats: 0,
          availableSeats: 0,
          heldSeats: 0,
          bookedSeats: 0,
          holdCount: 0,
          bookedCount: 0,
          grossAmount: 0,
          feeAmount: 0,
          currency: null,
          conversion: 0,
          occupancy: 0,
          updatedAt: null,
          asOf: Date.now(),
        });
      }
      return c.json({
        ...dash,
        updatedAt: toMs(dash.updatedAt),
        conversion: conversionRate(dash.bookedCount, dash.holdCount),
        occupancy: occupancyRate(dash.bookedSeats, dash.totalSeats),
        asOf: Date.now(),
      });
    },
  );
