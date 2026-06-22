/** outbox 再送 backstop の既定間隔（ms）。インライン publish 失敗時の保険。 */
export const OUTBOX_BACKSTOP_MS = 10_000;

/**
 * 単一 alarm を多重化するための次回 alarm 時刻を計算する（純粋）。
 * 「1 DO 1 alarm」制約下で outbox 再送 backstop と集約固有処理（Reservation の hold 失効）の
 * 最小時刻を返す。候補が無ければ null（alarm 不要）。
 */
export function computeNextAlarm(opts: {
  now: number;
  outboxRemaining: number;
  backstopDelayMs: number;
  /** Reservation の hold 失効時刻（epoch ms）。Phase 05 で渡す。 */
  holdExpiresAt?: number | null;
}): number | null {
  const candidates: number[] = [];
  if (opts.outboxRemaining > 0) {
    candidates.push(opts.now + opts.backstopDelayMs);
  }
  if (opts.holdExpiresAt != null) {
    candidates.push(opts.holdExpiresAt);
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}
