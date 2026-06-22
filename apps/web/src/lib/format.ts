/**
 * 表示整形・時刻変換の純粋ユーティリティ（DB/RPC 非依存＝テスト対象）。
 * 時刻の保存/比較は epoch ms（UTC）。本モジュールは **表示/入力変換**（瞬間 ⇄ JST 壁時計）だけを担う
 * （TZ 規約: クライアント責務）。Asia/Tokyo は DST 無し＝UTC+9 固定。
 */

const JST_OFFSET = "+09:00";

/** 最小単位の整数金額（JPY=円, USD=セント）を通貨表記へ。通貨の小数桁は Intl から取得。 */
export function formatMinorAmount(amount: number, currency: string): string {
  const fmt = new Intl.NumberFormat("ja-JP", { style: "currency", currency });
  const digits = fmt.resolvedOptions().maximumFractionDigits ?? 0;
  return fmt.format(amount / 10 ** digits);
}

/** epoch ms を JST の日時表示（例 "2026/07/01 19:00"）へ。 */
export function formatJstDateTime(epochMs: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(epochMs);
}

/** `asOf`（epoch ms）を "HH:mm:ss 時点" 表示へ（結果整合ラグの明示・FR-37）。 */
export function formatAsOf(epochMs: number): string {
  const t = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(epochMs);
  return `${t} 時点`;
}

/** 残り時間 ms（負にならない）。hold 失効カウントダウン用。 */
export function remainingMs(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, expiresAtMs - nowMs);
}

/** 残り ms を "M:SS" へ（カウントダウン表示）。 */
export function formatRemaining(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

/**
 * `<input type="datetime-local">` の壁時計文字列（例 "2026-07-01T19:00"）を **JST として** epoch ms へ。
 * 入力は TZ 情報を持たないため、明示的に +09:00 を付けて解釈する（ブラウザのローカル TZ に依存しない）。
 * 解釈不能なら null。
 */
export function jstWallClockToEpochMs(local: string): number | null {
  if (!local) return null;
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const ms = Date.parse(`${withSeconds}${JST_OFFSET}`);
  return Number.isNaN(ms) ? null : ms;
}

/** epoch ms を `<input type="datetime-local">` 用の JST 壁時計 "YYYY-MM-DDTHH:mm" へ。 */
export function epochMsToJstWallClock(epochMs: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(epochMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // en-CA は "YYYY-MM-DD" 形式。hour は 00-23。
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
