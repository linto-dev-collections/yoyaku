import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { ShowingStub } from "../durable-objects/_shared/rpc";
import { alertsFor } from "../lib/observability";
import { requireAdmin } from "../middleware/admin";
import { runArchive } from "../ops/archive";
import { gatherConversion, gatherMetrics } from "../ops/metrics";
import { runReconciliation } from "../ops/reconcile";
import { reproject } from "../ops/reproject";
import { RESETTABLE_PROJECTIONS } from "../queue/reprojection-plan";
import type { AppEnv, Bindings } from "../types";

const showingStub = (env: Bindings, id: string): ShowingStub =>
  env.SHOWING.getByName(id) as unknown as ShowingStub;

/** 再投影リクエスト。projections 省略時は全投影を FK 安全に再構築（withCascadeResets が補正）。 */
const reprojectSchema = z.object({
  projections: z
    .array(
      z.enum([
        "showings",
        "ticket_types",
        "seat_availabilities",
        "sales_dashboards",
        "reservations",
      ]),
    )
    .min(1)
    .optional(),
});

/**
 * 運用/管理エンドポイント（Phase 10・NFR-17）。全経路がプラットフォーム管理トークン（X-Admin-Token）必須。
 * read model は再構築可能・正本は DO/Stripe という前提で、照合・再投影・アーカイブ・as-of・運用集計を提供する。
 */
export const adminRoute = new Hono<AppEnv>()
  .use("*", requireAdmin)
  // 照合ジョブの手動実行（cron と同経路・FR-27）。
  .post("/reconciliations", async (c) => {
    const summary = await runReconciliation(c.env);
    return c.json(summary);
  })
  // 再投影（truncate→DO 再生→queue 再投入・NFR-17）。
  .post("/reprojections", zValidator("json", reprojectSchema), async (c) => {
    const { projections } = c.req.valid("json");
    const summary = await reproject(
      c.env,
      projections ?? RESETTABLE_PROJECTIONS,
    );
    return c.json(summary);
  })
  // events の R2 アーカイブ/プルーンの手動実行（cron と同経路・NFR-14/16）。
  .post("/archives", async (c) => {
    const summary = await runArchive(c.env);
    return c.json(summary);
  })
  // 運用メトリクス＋閾値アラート（NFR-09）。
  .get("/metrics", async (c) => {
    const metrics = await gatherMetrics();
    return c.json({ ...metrics, alerts: alertsFor(metrics), asOf: Date.now() });
  })
  // as-of 状態照会（FR-23・「販売開始 N 分後の残席」等）。t は epoch ms（省略時は現在）。
  .get("/showings/:id/as-of", async (c) => {
    const id = c.req.param("id");
    const t = Number(c.req.query("t"));
    const asOf = Number.isFinite(t) && t > 0 ? t : Date.now();
    const view = await showingStub(c.env, id).replayAsOf(asOf);
    return c.json(view);
  })
  // コンバージョン/離脱（FR-24）。確保→購入率・確保したが買わなかった割合。
  .get("/showings/:id/conversion", async (c) => {
    const id = c.req.param("id");
    const stats = await gatherConversion(id);
    return c.json({ showingId: id, ...stats, asOf: Date.now() });
  });
