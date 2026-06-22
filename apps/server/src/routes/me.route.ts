import { db } from "@yoyaku/db";
import { reservations } from "@yoyaku/db/schema";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type {
  ReservationStub,
  ReservationView,
} from "../durable-objects/_shared/rpc";
import { requireAuth } from "../middleware/auth";
import type { AppEnv, Bindings } from "../types";

const reservationStub = (env: Bindings, id: string): ReservationStub =>
  env.RESERVATION.getByName(id) as unknown as ReservationStub;

const toMs = (d: Date | null): number | null =>
  d != null ? d.getTime() : null;

/** マイチケットの統一 DTO（read model 行 / DO 直読 view を同形に正規化）。 */
type Ticket = {
  reservationId: string;
  showingId: string | null;
  organizationId: string | null;
  status: string;
  seatIds: string[];
  quantity: number | null;
  totalAmount: number | null;
  currency: string | null;
  holdExpiresAt: number | null;
  authorizedAt: number | null;
  confirmedAt: number | null;
  createdAt: number | null;
  /** 鮮度の出所（read_model=結果整合・do=直読で最新）。FR-37 の明示。 */
  source: "read_model" | "do";
};

const fromRow = (r: typeof reservations.$inferSelect): Ticket => ({
  reservationId: r.reservationId,
  showingId: r.showingId,
  organizationId: r.organizationId,
  status: r.status,
  seatIds: r.seatIds,
  quantity: r.quantity,
  totalAmount: r.totalAmount,
  currency: r.currency,
  holdExpiresAt: toMs(r.holdExpiresAt),
  authorizedAt: toMs(r.authorizedAt),
  confirmedAt: toMs(r.confirmedAt),
  createdAt: toMs(r.createdAt),
  source: "read_model",
});

const fromView = (v: ReservationView): Ticket => ({
  reservationId: v.reservationId,
  showingId: v.showingId,
  organizationId: v.organizationId,
  status: v.status,
  seatIds: v.seatIds,
  quantity: v.pricing?.quantity ?? null,
  totalAmount: v.pricing?.totalAmount ?? null,
  currency: v.pricing?.currency ?? null,
  holdExpiresAt: v.holdExpiresAt,
  authorizedAt: null,
  confirmedAt: null,
  createdAt: null,
  source: "do",
});

// 進行中（決済プロセス継続）／確定／終了済みの 3 区分（UC-07・§8）。
const IN_PROGRESS = new Set(["initiated", "awaiting_payment", "authorized"]);
const groupOf = (status: string): "confirmed" | "inProgress" | "past" => {
  if (status === "confirmed") return "confirmed";
  if (IN_PROGRESS.has(status)) return "inProgress";
  return "past"; // cancelled / expired / payment_failed / failed
};

/**
 * マイチケット（FR-19/34）。`reservations` を userId で必ずフィルタ（FR-33・他人の予約は出さない）。
 * status 別（確定/進行中/終了）にグループ化して返す。横断クエリ＝結果整合のため `asOf` を併記（FR-37）。
 *
 * **read-your-writes（自己予約マージ・指摘 5）**: 確保直後は投影ラグで新規予約が一覧に出ないことがある。
 * クライアントが直前に作成した reservationId を `?merge=<id>,<id>` で渡すと、その予約を Reservation DO から
 * 直読（view・最新）して一覧へ重畳する（reservationId で dedup・DO 側が優先・本人検証）。merge 無しなら
 * read model のみで安価。D1 Sessions API（bookmark）は別レイヤ＝レプリカ鮮度用で、この投影ラグは橋渡ししない。
 */
export const meRoute = new Hono<AppEnv>().get(
  "/tickets",
  requireAuth,
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);

    const rows = await db
      .select()
      .from(reservations)
      .where(eq(reservations.userId, user.id))
      .orderBy(desc(reservations.createdAt))
      .all();

    // reservationId → Ticket（read model）。DO 直読で上書きできるよう Map で保持。
    const byId = new Map<string, Ticket>(
      rows.map((r) => [r.reservationId, fromRow(r)]),
    );

    // 自己予約マージ: ?merge=id,id を DO 直読（本人のみ）で重畳して投影ラグを回避。
    const mergeIds = (c.req.query("merge") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const id of mergeIds) {
      const view = await reservationStub(c.env, id).view();
      if (view && view.userId === user.id) byId.set(id, fromView(view));
    }

    const confirmed: Ticket[] = [];
    const inProgress: Ticket[] = [];
    const past: Ticket[] = [];
    for (const t of byId.values()) {
      const bucket = groupOf(t.status);
      if (bucket === "confirmed") confirmed.push(t);
      else if (bucket === "inProgress") inProgress.push(t);
      else past.push(t);
    }

    return c.json({ asOf: Date.now(), confirmed, inProgress, past });
  },
);
