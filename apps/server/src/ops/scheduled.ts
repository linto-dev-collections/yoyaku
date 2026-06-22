import type { ScheduledController } from "@cloudflare/workers-types";
import { alertsFor, structuredLog } from "../lib/observability";
import type { Bindings } from "../types";
import { runArchive } from "./archive";
import { gatherMetrics } from "./metrics";
import { runReconciliation } from "./reconcile";

/** events アーカイブの cron 式（alchemy.run.ts の crons[1] と一致）。 */
export const ARCHIVE_CRON = "17 18 * * *";

/**
 * cron スケジュールのディスパッチ（FR-27/NFR-09/NFR-14）。alchemy の crons に応じて分岐:
 *  - 日次（ARCHIVE_CRON）: events の R2 アーカイブ/プルーン。
 *  - それ以外（15 分毎）: 照合ジョブ＋メトリクス収集→閾値アラートを構造化ログに出す。
 * 各処理は冪等で、失敗してもログを残して次回 cron で再収束する。
 */
export async function handleScheduled(
  controller: ScheduledController,
  env: Bindings,
): Promise<void> {
  if (controller.cron === ARCHIVE_CRON) {
    const result = await runArchive(env);
    console.log(structuredLog("info", "archive_run", { ...result }));
    return;
  }

  const recon = await runReconciliation(env);
  console.log(
    structuredLog("info", "reconciliation_run", {
      scanned: recon.scanned,
      corrected: recon.corrected,
      healed: recon.healed,
      ...recon.detected,
    }),
  );

  const metrics = await gatherMetrics();
  for (const alert of alertsFor(metrics)) {
    console.log(
      structuredLog(alert.level === "critical" ? "error" : "warn", "alert", {
        ...alert,
      }),
    );
  }
}
