import { DomainError } from "@yoyaku/domain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sessionMiddleware } from "./middleware/auth";
import { routes } from "./routes";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>()
  .use(logger())
  .use("/*", (c, next) =>
    cors({ origin: c.env.CORS_ORIGIN || "*", credentials: true })(c, next),
  )
  // 全リクエストでセッションを解決し Variables に載せる（拒否はしない）。CORS の後段。
  .use(sessionMiddleware)
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/", routes)
  .onError((err, c) => {
    if (err instanceof DomainError) {
      return c.json(
        { error: err.code, message: err.message },
        err.httpStatus as 409,
      );
    }
    console.error(err);
    return c.json({ error: "internal_error" }, 500);
  });

export default app;
export type AppType = typeof app;
