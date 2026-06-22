import { Hono } from "hono";
import type { AppEnv } from "../types";
import { adminRoute } from "./admin.route";
import { authRoute } from "./auth.route";
import { meRoute } from "./me.route";
import { organizationsRoute } from "./organizations.route";
import { reservationsRoute } from "./reservations.route";
import { showingsRoute } from "./showings.route";
import { stripeRoute } from "./stripe.route";

export const routes = new Hono<AppEnv>()
  .route("/api/auth", authRoute)
  .route("/api/stripe", stripeRoute)
  .route("/organizations", organizationsRoute)
  .route("/showings", showingsRoute)
  .route("/reservations", reservationsRoute)
  .route("/me", meRoute)
  // 運用/管理（Phase 10・NFR-17）。X-Admin-Token 必須。
  .route("/admin", adminRoute);

export type Routes = typeof routes;
