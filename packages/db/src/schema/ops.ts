// Stripe / Connect 運用テーブル（外部同期・非投影）。テーブル設計書 v1.3 §4.2。
// これらは同期書き込みの運用データなので認証への FK を張る（§1.4）。
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { organizations, users } from "./auth";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** 購入者の Stripe Customer（プラットフォーム顧客）。users とは分離（auth フィールド不変）。 */
export const userPaymentProfiles = sqliteTable(
  "user_payment_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(), // cus_xxx
    defaultPaymentMethodId: text("default_payment_method_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [index("user_payment_profiles_customer_idx").on(t.stripeCustomerId)],
);

/** 主催の Connect アカウント（1:1）。Accounts v2 では chargesEnabled=recipient transfer capability active。 */
export const organizationConnectAccounts = sqliteTable(
  "organization_connect_accounts",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    stripeConnectAccountId: text("stripe_connect_account_id")
      .notNull()
      .unique(), // acct_xxx
    chargesEnabled: integer("charges_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    payoutsEnabled: integer("payouts_enabled", { mode: "boolean" })
      .notNull()
      .default(false),
    detailsSubmitted: integer("details_submitted", { mode: "boolean" })
      .notNull()
      .default(false),
    onboardingStatus: text("onboarding_status", {
      enum: ["pending", "onboarding", "active", "restricted", "disabled"],
    })
      .notNull()
      .default("pending"),
    defaultCurrency: text("default_currency"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [index("connect_accounts_stripe_idx").on(t.stripeConnectAccountId)],
);

/** 受信 webhook の冪等（FR-11/25）。 */
export const stripeWebhookEvents = sqliteTable(
  "stripe_webhook_events",
  {
    id: text("id").primaryKey(), // Stripe event id（evt_xxx）
    type: text("type").notNull(),
    status: text("status", {
      enum: ["received", "processed", "skipped", "failed"],
    })
      .notNull()
      .default("received"),
    paymentIntentId: text("payment_intent_id"),
    reservationId: text("reservation_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("stripe_webhook_events_pi_idx").on(t.paymentIntentId),
    index("stripe_webhook_events_status_idx").on(t.status),
  ],
);

/** 照合の不一致記録（FR-27）。同一 (reservation_id, kind) の open を重複作成しない部分 UNIQUE。 */
export const reconciliationExceptions = sqliteTable(
  "reconciliation_exceptions",
  {
    id: text("id").primaryKey(), // ULID
    reservationId: text("reservation_id").notNull(),
    paymentIntentId: text("payment_intent_id"),
    kind: text("kind", {
      enum: [
        "paid_no_seat",
        "seat_no_paid",
        "dangling_auth",
        "amount_mismatch",
      ],
    }).notNull(),
    expectedAmount: integer("expected_amount"),
    actualAmount: integer("actual_amount"),
    currency: text("currency"),
    detail: text("detail", { mode: "json" }).$type<unknown>(),
    status: text("status", { enum: ["open", "resolved", "ignored"] })
      .notNull()
      .default("open"),
    detectedAt: integer("detected_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("reconciliation_exceptions_reservation_idx").on(t.reservationId),
    index("reconciliation_exceptions_status_idx").on(t.status),
    uniqueIndex("reconciliation_exceptions_open_uidx")
      .on(t.reservationId, t.kind)
      .where(sql`${t.status} = 'open'`),
  ],
);

/**
 * 投影 DLQ（dead letter）記録（NFR-09/14）。maxRetries 超過で DLQ に送られた毒メッセージを
 * DLQ consumer が永続記録する。無 consumer の DLQ は 4 日で消えるため、可観測性・運用是正の土台として
 * D1 に残す。eventId を PK とし、同一イベントの再 dead-letter は attempts を加算（冪等）。
 */
export const projectionDeadLetters = sqliteTable(
  "projection_dead_letters",
  {
    eventId: text("event_id").primaryKey(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    seq: integer("seq").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>(),
    lastError: text("last_error"),
    attempts: integer("attempts").notNull().default(1),
    status: text("status", { enum: ["open", "resolved", "ignored"] })
      .notNull()
      .default("open"),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("projection_dead_letters_status_idx").on(t.status),
    index("projection_dead_letters_aggregate_idx").on(
      t.aggregateType,
      t.aggregateId,
    ),
  ],
);
