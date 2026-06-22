import type { ProjectionMessage } from "../../types";

type AggregateType = ProjectionMessage["aggregateType"];

/** Showing ストリームを購読するか（position 前進の対象＝gap 連続性のため全 seq を見る）。 */
export const subscribesToShowing = (aggregateType: AggregateType): boolean =>
  aggregateType === "Showing";

/** Reservation ストリームを購読するか。 */
export const subscribesToReservation = (
  aggregateType: AggregateType,
): boolean => aggregateType === "Reservation";

/**
 * sales_dashboards は Showing（在庫カウント）と Reservation（売上）の**両ストリームを購読**する
 * （2 ストリーム集約・§1）。positions は consumer が `(projection, aggregateId)` で持つため、
 * ソース集約ごと（showingId / reservationId）に gap 検知＝増分が正確に1回だけ反映される。
 */
export const subscribesToSales = (aggregateType: AggregateType): boolean =>
  aggregateType === "Showing" || aggregateType === "Reservation";

/**
 * aggregate_registry は**全ストリームを購読**する（作成イベントで集約 ID を登録するため）。
 * position は consumer が `(projection, aggregateId)` で持つため、gap 検知＋ backfill により
 * 作成イベントが順序ずれで届いても確実に登録される。
 */
export const subscribesToAnyStream = (_aggregateType: AggregateType): boolean =>
  true;

// 各投影が read model 変更を起こす eventType（真偽表・純粋）。
export const SHOWINGS_EVENTS: ReadonlySet<string> = new Set([
  "ShowingRegistered",
  "ShowingPublished",
  "ShowingUnpublished",
  "ShowingClosed",
  "ShowingSoldOut",
]);

export const TICKET_TYPES_EVENTS: ReadonlySet<string> = new Set([
  "ShowingRegistered",
]);

export const SEAT_AVAILABILITIES_EVENTS: ReadonlySet<string> = new Set([
  "SeatsImported",
  "SeatsHeld",
  "SeatsBooked",
  "SeatsReleased",
]);

export const RESERVATIONS_EVENTS: ReadonlySet<string> = new Set([
  "ReservationInitiated",
  "ReservationHeld",
  "ReservationFailed",
  "ReservationPaymentPending",
  "ReservationAuthorized",
  "ReservationConfirmed",
  "ReservationExpired",
  "ReservationPaymentFailed",
  "ReservationCancelled",
]);

// sales_dashboards は Showing 由来（在庫カウント）と Reservation 由来（hold/booked 件数・売上）の和集合。
// ReservationHeld は holdCount（hold 到達予約数）の絶対再計算トリガー、ReservationConfirmed は件数/売上トリガー。
export const SALES_DASHBOARDS_EVENTS: ReadonlySet<string> = new Set([
  "ShowingRegistered",
  "SeatsImported",
  "SeatsHeld",
  "SeatsBooked",
  "SeatsReleased",
  "ReservationHeld",
  "ReservationConfirmed",
]);

/** この投影が当該 eventType で read model を変更するか（純粋・真偽表テスト用）。 */
export const handles = (
  events: ReadonlySet<string>,
  eventType: string,
): boolean => events.has(eventType);

/**
 * 集約の「作成イベント」か（aggregate_registry 登録のトリガー・純粋）。
 * Showing は ShowingRegistered、Reservation は ReservationInitiated が各ストリームの最初のイベント。
 */
export const isAggregateCreateEvent = (
  aggregateType: AggregateType,
  eventType: string,
): boolean =>
  (aggregateType === "Showing" && eventType === "ShowingRegistered") ||
  (aggregateType === "Reservation" && eventType === "ReservationInitiated");
