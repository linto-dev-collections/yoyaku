/** @type {import('dependency-cruiser').IConfiguration} */
// レイヤリングを静的に強制する（Phase 00）。
// - ドメイン層（domain/shared）は Cloudflare/Hono/Drizzle/Stripe/Next 等のインフラに依存しない（純粋）
// - データストア層（event-store/db）はドメイン/アプリへ依存しない（汎用）
// - packages は apps へ依存しない
// - web は server の ./hc / ./types のみ参照する
// - 循環依存を禁止する
//
// パス表現は cwd（リポジトリルート）相対。インフラ依存は pnpm 配下で domain から
// 解決できず「生の指定子」になり得るため、`(^|/)<name>` 境界でも一致させる。
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "循環依存は禁止（リプレイ/ビルド順序の破綻を防ぐ）",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-is-pure",
      severity: "error",
      comment:
        "packages/domain・packages/shared は cloudflare/hono/drizzle/better-auth/stripe/next/react に依存しない",
      from: { path: "^packages/(domain|shared)/src" },
      to: {
        path: "(^|/)(cloudflare:workers|hono|drizzle-orm|drizzle-kit|better-auth|stripe|next|next-themes|react|react-dom|@cloudflare/|@opennextjs/)",
      },
    },
    {
      name: "domain-no-workspace-deps",
      severity: "error",
      comment:
        "packages/domain は他ワークスペース実装（db/event-store/auth/ui/env/infra）に依存しない",
      from: { path: "^packages/domain/src" },
      to: { path: "^packages/(db|event-store|auth|ui|env|infra)/src" },
    },
    {
      name: "datastore-isolated",
      severity: "error",
      comment:
        "event-store・db は汎用基盤。domain/auth/ui/infra やアプリへ依存しない",
      from: { path: "^packages/(event-store|db)/src" },
      to: { path: "(^packages/(domain|auth|ui|infra)/src|^apps/)" },
    },
    {
      name: "packages-not-depend-on-apps",
      severity: "error",
      comment: "packages は apps へ依存しない（依存方向は apps→packages）",
      from: { path: "^packages/.+/src" },
      to: { path: "^apps/" },
    },
    {
      name: "web-uses-server-hc-only",
      severity: "error",
      comment:
        "apps/web は server の ./hc / ./types のみ参照（型安全 RPC 境界）",
      from: { path: "^apps/web/src" },
      to: {
        path: "^apps/server/src",
        pathNot: "^apps/server/src/(hc|types)\\.ts$",
      },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment:
        "孤立モジュール（誰からも参照されない）を検出（情報・gate は止めない）",
      from: {
        orphan: true,
        // ツール設定ファイルは各ツール（drizzle-kit/vitest/alchemy/next/postcss/tsdown 等）が
        // 直接読む entry で、ソースから import されないのは正当＝孤立判定の対象外とする。
        pathNot:
          "(\\.d\\.ts$|\\.test\\.ts$|/index\\.ts$|drizzle\\.config\\.ts$|vitest\\.config\\.ts$|alchemy\\.run\\.ts$|open-next\\.config\\.ts$|next\\.config\\.ts$|postcss\\.config\\.mjs$|tsdown\\.config\\.ts$)",
      },
      to: {},
    },
  ],
  options: {
    // node_modules は「辿らない」が依存エッジは記録する（domain-is-pure 検出に必要）。
    doNotFollow: { path: "node_modules" },
    // グラフから完全に除外する対象:
    // - ビルド成果物（.next/.open-next/dist/.turbo/.wrangler/.alchemy）= 生成物は解析しない。
    //   web は `@yoyaku/server/hc`（→ dist/hc.js）を参照する＝この dist 除外により web→server/src の
    //   `web-uses-server-hc-only` 違反にならない（Phase 08 で api.ts の暫定除外を解除済み）。
    exclude: {
      path: "(/\\.next/|/\\.open-next/|/\\.turbo/|/\\.wrangler/|/\\.alchemy/|(^|/)dist/)",
    },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require"],
    },
  },
};
