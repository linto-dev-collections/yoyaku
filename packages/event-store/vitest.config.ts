import { defineConfig } from "vitest/config";

// イベントストアの純粋ヘルパ（retention/canonicalize/request-hash 等）を Node 環境で単体検証する。
// DO/SQLite を伴う append/load/snapshot の実挙動は Phase 04 の縦切り E2E（pnpm dev）で確認。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
