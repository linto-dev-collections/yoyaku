// イベントストア（DO 内 SQLite）の汎用スキーマ。Showing/Reservation 共通。
// テーブル設計書 v1.3 §2（events / outboxes / snapshots(複合PK) / streams / idempotency_keys）。
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

type EventMetadata = {
  correlationId: string;
  causationId?: string;
  actor: string;
};

/** ジャーナル＝正本・追記専用。seq は集約バージョン（楽観ロック）。 */
export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateType: text("aggregate_type", {
      enum: ["Showing", "Reservation"],
    }).notNull(),
    eventId: text("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    metadata: text("metadata", { mode: "json" })
      .$type<EventMetadata>()
      .notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [
    index("events_type_idx").on(t.eventType),
    index("events_occurred_idx").on(t.occurredAt),
  ],
);

/** トランザクショナル・アウトボックス。行＝Queue メッセージ（envelope 全体・128KB 未満）。 */
export const outboxes = sqliteTable(
  "outboxes",
  {
    seq: integer("seq").primaryKey(),
    eventId: text("event_id").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    aggregateType: text("aggregate_type", {
      enum: ["Showing", "Reservation"],
    }).notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    metadata: text("metadata", { mode: "json" })
      .$type<EventMetadata>()
      .notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", { enum: ["pending", "published"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("outboxes_status_idx").on(t.status, t.seq)],
);

/** スナップショット。2MB 行上限回避のため (seq, part) で複数行に分割。 */
export const snapshots = sqliteTable(
  "snapshots",
  {
    seq: integer("seq").notNull(),
    part: text("part").notNull().default("full"),
    aggregateId: text("aggregate_id").notNull(),
    state: text("state", { mode: "json" }).$type<unknown>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.seq, t.part] })],
);

/** ストリーム head（単一行）。楽観ロック（version）の正本。 */
export const streams = sqliteTable("streams", {
  aggregateId: text("aggregate_id").primaryKey(),
  aggregateType: text("aggregate_type", {
    enum: ["Showing", "Reservation"],
  }).notNull(),
  version: integer("version").notNull().default(0),
  // 注: snapshot 位置は snapshots 表（latestSnapshotSeq）、publish 位置は outboxes.status から得るため、
  // streams に last_snapshot_seq / last_published_seq は持たない（未使用 dead column を除去）。
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(nowMs)
    .$onUpdate(() => new Date()),
});

/**
 * Saga 再駆動のための「pending 効果」（レビュー反映・指摘 1）。Reservation DO が
 * 他集約（Showing）/外部（Stripe）へ起こす効果を、コミットと同一 Tx で pending 記録し、
 * 効果完了で done 更新。DO 起動/alarm で未 done を冪等再駆動する。Showing DO では未使用。
 */
export const pendingEffects = sqliteTable(
  "pending_effects",
  {
    effectId: text("effect_id").primaryKey(),
    kind: text("kind", {
      enum: ["hold", "book", "release", "authorize", "capture", "void"],
    }).notNull(),
    payload: text("payload", { mode: "json" }).$type<unknown>().notNull(),
    status: text("status", { enum: ["pending", "done"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [index("pending_effects_status_idx").on(t.status)],
);

/** コマンド冪等（FR-25/28）。同一 key×異本文は request_hash 不一致で拒否。 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    commandType: text("command_type").notNull(),
    actor: text("actor").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["in_progress", "succeeded", "failed"] })
      .notNull()
      .default("in_progress"),
    firstSeq: integer("first_seq"),
    lastSeq: integer("last_seq"),
    responseJson: text("response_json", { mode: "json" }).$type<unknown>(),
    errorCode: text("error_code"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [index("idempotency_keys_expires_idx").on(t.expiresAt)],
);
