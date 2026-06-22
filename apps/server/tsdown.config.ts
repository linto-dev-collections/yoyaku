import { defineConfig } from "tsdown";

/**
 * `@yoyaku/server/hc`（型安全 RPC の境界）だけをビルドする。
 * - エントリは `src/hc.ts`。`AppType` は `import type` で取り込まれ実行時には消えるため、
 *   ルート（routes→db/event-store→生成 .sql）はバンドルに入らない（.sql パースエラーを回避）。
 * - 実体の Worker（`src/index.ts`）は alchemy/wrangler が直接バンドルして配信する（infra `entrypoint`）。
 *   よってこの dist は web が参照する `./hc`（hcWithType）の JS のみを生成する。型宣言は tsc（tsconfig.build.json）。
 */
export default defineConfig({
  entry: ["./src/hc.ts"],
  format: "esm",
  platform: "neutral",
  dts: false,
  external: ["cloudflare:workers"],
});
