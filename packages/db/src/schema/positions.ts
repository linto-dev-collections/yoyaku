// 投影ブックキーピング（冪等 + gap 検知）。テーブル設計書 v1.3 §4.4。
import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const positions = sqliteTable(
  "positions",
  {
    projection: text("projection").notNull(), // 'seat_availabilities' | 'reservations' | 'sales_dashboards' | ...
    aggregateId: text("aggregate_id").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs)
      .$onUpdate(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.projection, t.aggregateId] })],
);
