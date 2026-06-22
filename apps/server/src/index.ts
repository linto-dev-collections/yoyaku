// 起動時 env fail-fast 検証（副作用 import・最優先）。Worker ロード時に `@yoyaku/env/server` の
// serverEnvSchema.parse(env) が走り、必須環境変数の欠落/不正があればモジュール読込で即失敗する
// （運用安全）。cloudflare:workers の env はトップレベルで参照可能・Node ツール経由はスタブでスキップ
// される（packages/env/src/server.ts 参照）。cloudflare:workers は build で external 扱い。
import "@yoyaku/env/server";
import type {
  MessageBatch,
  ScheduledController,
} from "@cloudflare/workers-types";
import app from "./app";
import { handleScheduled } from "./ops/scheduled";
import { handleDeadLetterBatch } from "./queue/dead-letter-consumer";
import { handleProjectionBatch } from "./queue/projection-consumer";
import type { Bindings, ProjectionMessage } from "./types";

// Durable Object クラスを Worker から export（alchemy.run.ts の className と一致）。
export { IntakeDO } from "./durable-objects/intake.do";
export { ReservationDO } from "./durable-objects/reservation.do";
export { ShowingDO } from "./durable-objects/showing.do";

export default {
  fetch: app.fetch,
  // 単一 queue ハンドラが両 consumer を受ける。batch.queue（キュー名）で振り分ける:
  // DLQ（PROJECTION_DLQ_NAME）は毒メッセージ記録、それ以外は通常の投影。
  async queue(
    batch: MessageBatch<ProjectionMessage>,
    env: Bindings,
  ): Promise<void> {
    if (batch.queue === env.PROJECTION_DLQ_NAME) {
      await handleDeadLetterBatch(batch);
      return;
    }
    await handleProjectionBatch(batch, env);
  },
  // cron triggers（Phase 10）: 照合（15 分毎）＋ events アーカイブ（日次）。controller.cron で分岐。
  async scheduled(
    controller: ScheduledController,
    env: Bindings,
  ): Promise<void> {
    await handleScheduled(controller, env);
  },
};

export type { AppType } from "./app";
