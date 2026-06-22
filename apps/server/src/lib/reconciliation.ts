/**
 * 照合（FR-27）の不一致**判定**を純粋関数に切り出す（DB/Stripe 非依存＝vitest 対象）。
 * 入力は「予約 read model」「PaymentIntent 状態（正本）」「席の booked 反映」から組んだ事実（fact）。
 * I/O・是正はランナー（ops/reconcile.ts）が担い、ここは分類のみ。
 */

/** reconciliation_exceptions.kind（テーブル設計書 v1.3 §4.2）。 */
export type ReconciliationKind =
  | "paid_no_seat"
  | "seat_no_paid"
  | "dangling_auth"
  | "amount_mismatch";

/** Stripe PaymentIntent.status（照合で見る部分集合）。 */
export type PaymentIntentStatus =
  | "requires_payment_method"
  | "requires_confirmation"
  | "requires_action"
  | "processing"
  | "requires_capture"
  | "canceled"
  | "succeeded";

/** 予約 read model の状態（API 形・小文字）。 */
export type ReservationFactStatus =
  | "initiated"
  | "awaiting_payment"
  | "authorized"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "payment_failed"
  | "failed";

/** 1 予約分の照合事実。PI 状態が正本、席/金額は read model・固定額。 */
export type ReconciliationFact = {
  reservationStatus: ReservationFactStatus;
  /** PI 未作成（未到達）は null。 */
  paymentIntentStatus: PaymentIntentStatus | null;
  /** 当該予約の席がすべて booked 反映済みか。 */
  seatsBooked: boolean;
  /** 固定額（FR-38・reservation.totalAmount）。 */
  expectedAmount: number;
  /** PI のキャプチャ確定額（amount_received）。未入金は null。 */
  capturedAmount: number | null;
  /** 確保期限切れ（holdExpiresAt < now）。dangling_auth 判定に使う。 */
  holdExpired: boolean;
};

/** 予約終端（席を持ち続けるべきでない）状態。 */
const TERMINATED: ReadonlySet<ReservationFactStatus> = new Set([
  "cancelled",
  "expired",
  "payment_failed",
  "failed",
]);

/**
 * 不一致を 1 種別に分類（無ければ null）。優先度は是正の実効性順:
 * 1. paid_no_seat   : 入金成立（succeeded）だが席が booked でない → BookSeats 冪等リトライ（FR-39）。
 * 2. amount_mismatch: 入金成立だがキャプチャ額 ≠ 固定額（FR-38）→ 調査（手動・返金/調整）。
 * 3. dangling_auth  : requires_capture のまま予約が終端 or 確保失効 → PI を void。
 * 4. seat_no_paid   : 席 booked だが入金成立でない（原則発生しない設計）→ 調査（手動）。
 */
export function classifyReconciliation(
  f: ReconciliationFact,
): ReconciliationKind | null {
  if (f.paymentIntentStatus === "succeeded") {
    if (!f.seatsBooked) return "paid_no_seat";
    if (f.capturedAmount !== null && f.capturedAmount !== f.expectedAmount) {
      return "amount_mismatch";
    }
    return null;
  }

  if (
    f.paymentIntentStatus === "requires_capture" &&
    (TERMINATED.has(f.reservationStatus) || f.holdExpired)
  ) {
    return "dangling_auth";
  }

  // ここに到達 = PI が succeeded でない（上で return 済み）。席が booked なら入金なしの席確定
  // ＝設計上発生しない（要調査）。
  if (f.seatsBooked) return "seat_no_paid";

  return null;
}

/** 自動是正の対象種別（その他は open 記録のみ＝手動調査）。 */
export function isAutoCorrectable(kind: ReconciliationKind): boolean {
  return kind === "paid_no_seat" || kind === "dangling_auth";
}
