/** 確保・購入のポリシー定数（確定既定値）。純粋・依存なし。 */

/** 確保 TTL = 10 分（hold 失効。既定値）。holdExpiresAt = requestedAt + これ。 */
export const HOLD_TTL_MS = 10 * 60 * 1000;

/** 1 ユーザー 1 公演あたりの購入上限（席数。既定 4・FR-15/BR-05）。 */
export const MAX_SEATS_PER_USER = 4;

/**
 * pending_effect の再駆動試行回数のエスカレーション閾値（NFR-03/09）。alarm backstop（≒10s）ごとに
 * 1 回再駆動するため、50 回 ≒ 8 分超の連続失敗で「恒久失敗の疑い」として構造化ログを出す
 * （再駆動は止めず収束を諦めない）。打ち切りはせず観測下に置く＝Workers Logs からアラート可能にする。
 */
export const MAX_EFFECT_ATTEMPTS = 50;

/** 1 回の ImportSeats で投入できる席数の粗い上限（席数ベースの早期拒否・既定 2,000）。 */
export const IMPORT_MAX_SEATS_PER_REQUEST = 2000;

/**
 * 1 回の ImportSeats イベント payload のバイト数上限（**実バイトで 128KB を保証**）。
 * Cloudflare Queues は 1 メッセージ 128KB（≒131,072B）＋内部メタ ~100B が上限。envelope ラッパ
 * （eventId/aggregateId/metadata 等 ~数百B）の余裕を見て 120,000B を閾値とする。超過は 413 で拒否し
 * section を分割させる（席数だけでは長い seatId/label でバイト超過し publish が恒久失敗するのを防ぐ）。
 */
export const IMPORT_MAX_PAYLOAD_BYTES = 120_000;

/**
 * プラットフォーム手数料（basis points。1000 = 10%）。Connect destination charge の
 * `application_fee_amount`。確保時に固定価格へ組み込む（FR-38/BR-14）。組織/公演別の上書きは将来対応。
 */
export const APPLICATION_FEE_BPS = 1000;
