import { defineConfig } from "vitest/config";

// ドメイン層は Cloudflare 非依存の純粋ロジック。Node 環境で decide/evolve を単体検証する。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
