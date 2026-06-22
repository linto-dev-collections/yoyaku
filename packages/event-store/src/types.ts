// イベント envelope と append の入出力型（テーブル設計書 §2.3）。
// 汎用イベントストアの原則: payload は unknown で受け、判別子（eventType）で
// アプリ/投影側が型を復元する。ドメイン型（ShowingEvent 等）には依存しない。

export type AggregateType = "Showing" | "Reservation";

/** イベント/コマンド共通メタデータ（FR-22/28）。schema.ts の EventMetadata と同形。 */
export type EventMetadata = {
  correlationId: string;
  causationId?: string;
  actor: string;
};

/** これから追記するドメイン由来イベント（envelope 付与前）。 */
export type NewEvent = {
  /** 判別子（decide が返すドメインイベントの `type`）。例: "SeatsHeld"。 */
  eventType: string;
  /** ドメインイベント本体（ShowingEvent/ReservationEvent 等）。 */
  payload: unknown;
  /** ドメイン時刻（epoch ms）。通常はコマンド実行時刻。 */
  occurredAt: number;
  /** スキーマ版（既定 1）。 */
  schemaVersion?: number;
};

export type AppendInput = {
  aggregateId: string;
  aggregateType: AggregateType;
  /** 現在の head（streams.version）。0=新規ストリーム。 */
  expectedVersion: number;
  events: NewEvent[];
  metadata: EventMetadata;
};

export type AppendOk = {
  /** 追記した最初の seq（events 無しの no-op 時は toSeq+1）。 */
  fromSeq: number;
  /** 追記後の head（= streams.version）。 */
  toSeq: number;
  eventIds: string[];
};

/** snapshot の 1 part（2MB 行上限回避のため part 単位で分割保存）。 */
export type SnapshotPart = { part: string; state: unknown };
