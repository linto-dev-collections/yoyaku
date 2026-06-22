// 集約レジストリ（追記専用・cold rebuild 基盤）。テーブル設計書 v1.3 §4.5。
// 全集約 ID を read model から独立して保持し、再投影／後追い projection の再生で
// 「再生対象の集約 ID 集合」を列挙可能にする。reproject は read model を truncate するため、
// read model からの ID 列挙は「truncate で消える前提」に依存していた（ニワトリ卵）。
// このテーブルはそれを断ち切り、read model 全損・新規 projection 追加でも ID 集合を保持する。
import { sql } from "drizzle-orm";
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * 集約レジストリ。作成イベント（ShowingRegistered / ReservationInitiated）の到達時に
 * 投影パイプライン（aggregate-registry.projection）が insert-or-ignore で 1 行登録する。
 * **RESETTABLE に含めない**＝reproject で truncate されず、read model とは独立に存続する。
 */
export const aggregateRegistry = sqliteTable(
  "aggregate_registry",
  {
    aggregateType: text("aggregate_type", {
      enum: ["Showing", "Reservation"],
    }).notNull(),
    aggregateId: text("aggregate_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(nowMs),
  },
  (t) => [primaryKey({ columns: [t.aggregateType, t.aggregateId] })],
);
