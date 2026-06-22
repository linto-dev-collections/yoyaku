/**
 * 再投影の**計画**（純粋・DB 非依存＝vitest 対象）。リセット対象投影と、それを再構築するために
 * 再生すべきソースストリームの対応を定義する。実 I/O（truncate / DO 再生 / queue 再投入）は
 * reprojection.ts（reset）と ops/reproject.ts（再生）が担う。
 */

/** 再投影で truncate＋positions リセットできる投影名（NFR-17）。 */
export type ResettableProjection =
  | "showings"
  | "ticket_types"
  | "seat_availabilities"
  | "sales_dashboards"
  | "reservations";

/**
 * リセット可能な全投影（管理エンドポイントの検証・全体再構築の既定に使う）。
 * `reservations` は Reservation ストリーム単独・FK cascade 無し＝独立に再構築可能（末尾）。
 * これにより**全 read model が正本イベントから再構築可能**になる（外部レビュー指摘5a・NFR-17）。
 */
export const RESETTABLE_PROJECTIONS: readonly ResettableProjection[] = [
  "showings",
  "ticket_types",
  "seat_availabilities",
  "sales_dashboards",
  "reservations",
];

/**
 * FK cascade を考慮してリセット集合を補正する（純粋）。`showings` の truncate は
 * onDelete cascade で `ticket_types` / `seat_availabilities` の行も削るため、それらの positions も
 * 併せてリセットしないと「行は消えたが position は head のまま＝再構築されない」状態になる（runbook §3）。
 * 戻り値は `RESETTABLE_PROJECTIONS` の安定順。
 */
export function withCascadeResets(
  names: readonly ResettableProjection[],
): ResettableProjection[] {
  const set = new Set<ResettableProjection>(names);
  if (set.has("showings")) {
    set.add("ticket_types");
    set.add("seat_availabilities");
  }
  return RESETTABLE_PROJECTIONS.filter((p) => set.has(p));
}

/** 再生に必要なソースストリーム。再投影時にどの DO 群を再生すべきか決める。 */
export type SourceStreams = { showing: boolean; reservation: boolean };

/**
 * 対象投影群を再構築するのに再生すべきソースストリームを導く（純粋）。
 * - showings / ticket_types / seat_availabilities … Showing ストリームのみ。
 * - reservations … Reservation ストリームのみ（購入プロセスの状態＋価格固定一式）。
 * - sales_dashboards … Showing（在庫）＋ Reservation（売上）の 2 ストリーム集約。
 * 注: `showings` の truncate は FK cascade で ticket_types / seat_availabilities 行も消すため、
 * `showings` を再投影する際は同ストリームの 3 投影を併せてリセットするのが安全（runbook §3）。
 */
export function streamsForProjections(
  names: readonly ResettableProjection[],
): SourceStreams {
  let showing = false;
  let reservation = false;
  for (const n of names) {
    if (
      n === "showings" ||
      n === "ticket_types" ||
      n === "seat_availabilities"
    ) {
      showing = true;
    }
    if (n === "reservations") {
      reservation = true;
    }
    if (n === "sales_dashboards") {
      showing = true;
      reservation = true;
    }
  }
  return { showing, reservation };
}
