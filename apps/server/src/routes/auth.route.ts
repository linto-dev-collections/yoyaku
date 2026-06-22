import { auth } from "@yoyaku/auth";
import { Hono } from "hono";
import type { AppEnv } from "../types";

/** Better Auth を catch-all でマウント（Google サインインのみ）。 */
export const authRoute = new Hono<AppEnv>().on(["POST", "GET"], "/*", (c) =>
  auth.handler(c.req.raw),
);
