import { Hono } from "hono";
import { routePath } from "hono/route";
import { apiError } from "../shared/http.ts";
import {
  requireAuth,
  requireCookieRequestOrigin,
  type AuthenticateRequest,
  type AuthEnv,
} from "./auth.ts";
import { createNoteRoutes } from "./notes.ts";

export type AppOptions = Readonly<{
  authRoutes?: Hono;
  appOrigin?: string;
}>;

export function createApp(authenticateRequest: AuthenticateRequest, options: AppOptions = {}) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  if (options.appOrigin) app.use("/api/*", requireCookieRequestOrigin(options.appOrigin));
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  if (options.authRoutes) app.route("/api/auth", options.authRoutes);

  const api = new Hono<AuthEnv>();
  api.use("*", requireAuth(authenticateRequest));
  api.route("/notes", createNoteRoutes());
  app.route("/api", api);
  app.notFound((c) => c.json(apiError("NOT_FOUND", "Route not found."), 404));
  app.onError((_error, c) => {
    // Route templates omit user-supplied IDs and query strings.
    console.error("API request failed.", { method: c.req.method, route: routePath(c, -1) });
    return Response.json(apiError("INTERNAL_ERROR", "Request failed."), {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  });
  return app;
}
