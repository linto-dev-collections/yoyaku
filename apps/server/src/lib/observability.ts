/**
 * 可観測性（NFR-09）の純粋ヘルパ。集計・アラート判定・構造化ログ整形を DB/時刻 非依存にして
 * vitest 対象にする。I/O（D1 集計クエリ・console 出力）はランナー（ops/metrics.ts）が担う。
 */

/** `SELECT key, count(*) GROUP BY key` の行。 */
export type CountRow = { key: string; count: number };

/** 行配列 → `{ key: count }`（欠損キーは 0 を補完しない＝存在分のみ）。 */
export function tally(rows: readonly CountRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key] = (out[r.key] ?? 0) + r.count;
  return out;
}

/** 数値マップの合計。 */
export function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** メトリクス・スナップショット（運用ダッシュボード/アラートの元）。 */
export type MetricsSnapshot = {
  reservationsByStatus: Record<string, number>;
  openExceptionsByKind: Record<string, number>;
  webhookEventsByStatus: Record<string, number>;
  /** 投影 DLQ の未対応（open）件数。毒メッセージがサイレントに失われていないかの可視化（指摘2）。 */
  openDeadLetters: number;
};

export type AlertLevel = "warn" | "critical";
export type Alert = {
  level: AlertLevel;
  code: string;
  message: string;
  value: number;
};

/**
 * 閾値アラート（純粋）。照合 open は運用が手当てすべき不一致、webhook failed は取りこぼし兆候、
 * authorized 滞留は反映ラグ/与信放置の兆候。閾値超過は構造化ログ＋運用通知へ（ops 側）。
 */
export function alertsFor(s: MetricsSnapshot): Alert[] {
  const alerts: Alert[] = [];
  const openExceptions = sumCounts(s.openExceptionsByKind);
  if (openExceptions > 0) {
    alerts.push({
      level: "critical",
      code: "reconciliation_open",
      message: `${openExceptions} open reconciliation exception(s)`,
      value: openExceptions,
    });
  }
  const failedWebhooks = s.webhookEventsByStatus.failed ?? 0;
  if (failedWebhooks > 0) {
    alerts.push({
      level: "warn",
      code: "webhook_failed",
      message: `${failedWebhooks} failed webhook event(s)`,
      value: failedWebhooks,
    });
  }
  const stuckAuthorized = s.reservationsByStatus.authorized ?? 0;
  if (stuckAuthorized > 0) {
    alerts.push({
      level: "warn",
      code: "authorized_backlog",
      message: `${stuckAuthorized} reservation(s) stuck in authorized`,
      value: stuckAuthorized,
    });
  }
  if (s.openDeadLetters > 0) {
    alerts.push({
      level: "critical",
      code: "projection_dead_letters_open",
      message: `${s.openDeadLetters} unhandled projection dead letter(s)`,
      value: s.openDeadLetters,
    });
  }
  return alerts;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 構造化ログ 1 行（JSON 文字列・純粋）。Cloudflare Workers Logs は stdout を取り込むため
 * `console.log(structuredLog(...))` で集計可能なログを出す。時刻はランナーが `at` で注入（純粋性のため）。
 */
export function structuredLog(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): string {
  return JSON.stringify({ level, event, ...fields });
}
