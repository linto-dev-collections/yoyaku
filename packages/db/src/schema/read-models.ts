// ドメイン read model（投影）。テーブル設計書 v1.3 §4.3。
// FK 方針（§1.4）: 同一 Showing ストリーム親子（showings→ticket_types/seat_availabilities）のみ物理 FK。
// read model→認証（organization_id/user_id）と別ストリーム間（reservations.showing_id）は索引のみ＝論理参照（再投影耐性 NFR-17）。
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const showings = sqliteTable(
  "showings",
  {
    showingId: text("showing_id").primaryKey(), // ULID
    // 論理参照（organizations）。物理 FK は張らない（再投影耐性・§1.4）。
    organizationId: text("organization_id").notNull(),
    title: text("title").notNull(),
    venue: text("venue"),
    startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
    salesStartAt: integer("sales_start_at", { mode: "timestamp_ms" }),
    salesEndAt: integer("sales_end_at", { mode: "timestamp_ms" }),
    // ShowingRegistered→draft / ShowingPublished→on_sale / ShowingUnpublished→draft / ShowingClosed→closed / ShowingSoldOut→sold_out
    status: text("status", { enum: ["draft", "on_sale", "closed", "sold_out"] })
      .notNull()
      .default("draft"),
    currency: text("currency").notNull(),
    totalSeats: integer("total_seats").notNull().default(0),
    // 公平性/不正対策（Phase 09・NFR-15/FR-15）。区分と公演別の購入上限。
    riskTier: text("risk_tier", {
      enum: ["general", "popular", "high_risk"],
    })
      .notNull()
      .default("general"),
    maxSeatsPerUser: integer("max_seats_per_user").notNull().default(4),
    lastSeq: integer("last_seq").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("showings_organization_id_idx").on(t.organizationId),
    index("showings_status_starts_idx").on(t.status, t.startsAt),
  ],
);

export const ticketTypes = sqliteTable(
  "ticket_types",
  {
    showingId: text("showing_id")
      .notNull()
      .references(() => showings.showingId, { onDelete: "cascade" }), // 同一ストリーム親子・FK 可
    ticketTypeId: text("ticket_type_id").notNull(),
    name: text("name").notNull(),
    unitAmount: integer("unit_amount").notNull(), // 単価（最小単位・現行カタログ価格）
    currency: text("currency").notNull(),
    capacity: integer("capacity"),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.showingId, t.ticketTypeId] })],
);

export const seatAvailabilities = sqliteTable(
  "seat_availabilities",
  {
    showingId: text("showing_id")
      .notNull()
      .references(() => showings.showingId, { onDelete: "cascade" }),
    seatId: text("seat_id").notNull(), // 例 'A-12'
    section: text("section"),
    rowLabel: text("row_label"),
    seatNumber: text("seat_number"),
    ticketTypeId: text("ticket_type_id"), // 論理参照（同一公演内）
    status: text("status", { enum: ["available", "held", "booked"] })
      .notNull()
      .default("available"),
    heldByReservationId: text("held_by_reservation_id"),
    bookedByReservationId: text("booked_by_reservation_id"),
    holdExpiresAt: integer("hold_expires_at", { mode: "timestamp_ms" }),
    lastSeq: integer("last_seq").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.showingId, t.seatId] }),
    index("seat_availabilities_status_idx").on(t.showingId, t.status),
  ],
);

export const reservations = sqliteTable(
  "reservations",
  {
    reservationId: text("reservation_id").primaryKey(), // ULID
    // read model→認証/別ストリームは論理参照（索引のみ・§1.4）。
    userId: text("user_id").notNull(),
    showingId: text("showing_id").notNull(),
    organizationId: text("organization_id"),
    status: text("status", {
      enum: [
        "initiated",
        "awaiting_payment",
        "authorized",
        "confirmed",
        "cancelled",
        "expired",
        "payment_failed",
        "failed",
      ],
    })
      .notNull()
      .default("initiated"),
    seatIds: text("seat_ids", { mode: "json" }).$type<string[]>().notNull(),
    // 価格固定（FR-38/BR-14）
    quantity: integer("quantity").notNull(),
    subtotalAmount: integer("subtotal_amount").notNull(),
    applicationFeeAmount: integer("application_fee_amount")
      .notNull()
      .default(0),
    totalAmount: integer("total_amount").notNull(),
    currency: text("currency").notNull(),
    lineItems: text("line_items", { mode: "json" }).$type<
      Array<{ ticketTypeId: string; seatId: string; unitAmount: number }>
    >(),
    // 決済（PaymentIntent 状態の投影。正本は Reservation DO / Stripe）
    paymentIntentId: text("payment_intent_id").unique(),
    holdExpiresAt: integer("hold_expires_at", { mode: "timestamp_ms" }),
    authorizedAt: integer("authorized_at", { mode: "timestamp_ms" }),
    confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
    lastSeq: integer("last_seq").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("reservations_user_idx").on(t.userId, t.status),
    index("reservations_showing_idx").on(t.showingId),
    index("reservations_organization_idx").on(t.organizationId),
    index("reservations_status_idx").on(t.status),
  ],
);

export const salesDashboards = sqliteTable(
  "sales_dashboards",
  {
    showingId: text("showing_id").primaryKey(),
    organizationId: text("organization_id"),
    totalSeats: integer("total_seats").notNull().default(0),
    availableSeats: integer("available_seats").notNull().default(0),
    heldSeats: integer("held_seats").notNull().default(0),
    bookedSeats: integer("booked_seats").notNull().default(0),
    holdCount: integer("hold_count").notNull().default(0),
    bookedCount: integer("booked_count").notNull().default(0),
    grossAmount: integer("gross_amount").notNull().default(0),
    feeAmount: integer("fee_amount").notNull().default(0),
    currency: text("currency"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [index("sales_dashboards_organization_idx").on(t.organizationId)],
);
