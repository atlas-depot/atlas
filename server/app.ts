import { Hono } from "hono";
import { apiError } from "../shared/notes.ts";

export type Session = Readonly<{ userId: string }>;
export type SessionResolver = (request: Request) => Promise<Session | null>;

// #47 will supply the verified WorkOS session resolver at composition time.
// No header, query parameter or environment flag can enable fake authentication.
export function createApp(resolveSession: SessionResolver = async () => null) {
  const app = new Hono<{ Variables: { session: Session } }>();

  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  const notes = new Hono<{ Variables: { session: Session } }>();
  notes.use("*", async (c, next) => {
    const session = await resolveSession(c.req.raw);
    if (!session) {
      return c.json(apiError("UNAUTHENTICATED", "Sign in to access notes."), 401);
    }
    c.set("session", session);
    await next();
  });
  // Reserve the agreed routes without inventing persistence or successful writes.
  // #51 will connect validated inputs to user-scoped note operations.
  notes.on(["GET", "POST"], "/", (c) =>
    c.json(apiError("NOT_IMPLEMENTED", "Note storage is not connected yet."), 501),
  );
  notes.on(["GET", "PUT", "DELETE"], "/:id", (c) =>
    c.json(apiError("NOT_IMPLEMENTED", "Note storage is not connected yet."), 501),
  );
  app.route("/api/notes", notes);
  app.notFound((c) => c.json(apiError("NOT_FOUND", "Route not found."), 404));
  app.onError(() =>
    Response.json(apiError("INTERNAL_ERROR", "Request failed."), {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    }),
  );
  return app;
}
