import {
  createNoteIndexRoutes,
  type NoteIndexService,
  type NoteSaved,
} from "./note-index-routes.ts";
import { Hono } from "hono";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { apiError } from "../shared/http.ts";
import {
  requireAuth,
  requireCookieRequestOrigin,
  type AuthenticateRequest,
  type AuthEnv,
} from "./auth.ts";
import { createNoteRoutes, type NoteService } from "./notes.ts";
import { createOrganizeRoutes, type OrganizeService } from "./organize-routes.ts";
import { createNoteSearchRoutes, type NoteSearchService } from "./note-search-routes.ts";

export type AppOptions = Readonly<{
  authRoutes?: Hono;
  protectedRoutes?: Hono<AuthEnv>;
  appOrigin?: string;
  organizer?: OrganizeService;
  notes?: NoteService;
  indexing?: NoteIndexService;
  search?: NoteSearchService;
  embedSearch?: (query: string) => Promise<number[]>;
  onNoteSaved?: NoteSaved;
}>;

export function createApp(authenticateRequest: AuthenticateRequest, options: AppOptions = {}) {
  const app = new Hono();

  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  if (options.appOrigin) app.use("/api/*", requireCookieRequestOrigin(options.appOrigin));
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  if (options.authRoutes) app.route("/api/auth", options.authRoutes);

  const api = new Hono<AuthEnv>();
  api.use("*", requireAuth(authenticateRequest));
  api.route("/notes", createNoteRoutes(options.notes, options.onNoteSaved));
  api.route("/notes", createNoteIndexRoutes(options.indexing));
  api.route("/note-search", createNoteSearchRoutes(options.search, options.embedSearch));
  api.route("/", createOrganizeRoutes(options.organizer, options.onNoteSaved));
  if (options.protectedRoutes) api.route("/", options.protectedRoutes);
  app.route("/api", api);
  app.notFound((c) => c.json(apiError("NOT_FOUND", "Route not found."), 404));
  app.onError((_error, c) => {
    // Route templates omit user-supplied IDs and query strings.
    console.error("API request failed.", { method: c.req.method, route: routePath(c, -1) });
    const headers = new Headers({ "Cache-Control": "no-store" });
    const authHeaders = c.get("authResponseHeaders" as never) as Headers | undefined;
    authHeaders?.forEach((value, name) => headers.append(name, value));
    return Response.json(apiError("INTERNAL_ERROR", "Request failed."), {
      status: 500,
      headers,
    });
  });
  return app;
}
