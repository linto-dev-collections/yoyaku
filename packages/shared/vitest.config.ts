import { defineConfig } from "vitest/config";

// 純粋ユーティリティ（業務TZの日境界キー等）を Node 環境で検証。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
