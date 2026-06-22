import { defineConfig } from "drizzle-kit";

// イベントストア（Durable Objects 内 SQLite）。durable-sqlite ドライバで生成。
// 生成物は ./drizzle（DO 起動時に migrator で適用）。
export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "sqlite",
  driver: "durable-sqlite",
});
