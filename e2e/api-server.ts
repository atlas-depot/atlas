/** Test-only identity seam. Never imported by production entrypoints or deployed. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { Pool } from "pg";
import { createApp } from "../server/app.ts";
import { readCookie } from "../server/cookies.ts";
import { openDatabase, readTestDatabaseUrl } from "../server/db/connection.ts";
import { createNoteStore } from "../server/db/notes.ts";
import { apiError } from "../shared/http.ts";

const origin = "http://127.0.0.1:4185";
function account(request: Request) {
  const id = readCookie(request.headers.get("Cookie"), "atlas_session");
  return id && /^test_[a-f0-9]{32}$/.test(id) ? id : null;
}

export default async function setup() {
  const databaseName = `atlas_browser_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool | undefined;
  let database: ReturnType<typeof openDatabase> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let created = false;
  async function cleanup() {
    if (server?.listening) {
      await new Promise<void>((resolve) => {
        server?.close(() => resolve());
        if (server && "closeAllConnections" in server) server.closeAllConnections();
      });
    }
    await database?.close();
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    }
  }
  try {
    // Reject remote targets and missing configuration before any database operation.
    const url = new URL(readTestDatabaseUrl(process.env));
    await promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL("../node_modules/vite-plus/bin/vp", import.meta.url)),
        "build",
        "--outDir",
        ".cache/api-build",
      ],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: { ...process.env, VITE_NOTES_DEMO: "false" },
        timeout: 120_000,
      },
    );
    admin = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 10_000 });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    database = openDatabase(url.toString());
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)),
    });
    const authRoutes = new Hono();
    authRoutes.get("/session", (c) => {
      const id = account(c.req.raw);
      if (!id) return c.json(apiError("UNAUTHENTICATED", "Synthetic session required."), 401);
      return c.json({
        user: { id, email: `${id}@example.test`, firstName: "Synthetic", lastName: null },
      });
    });
    authRoutes.post("/logout", (c) => {
      c.header("Set-Cookie", "atlas_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      return c.redirect("/", 303);
    });
    const api = createApp(
      async (request) => {
        const userId = account(request);
        return userId ? { userId } : null;
      },
      { notes: createNoteStore(database.db), authRoutes, appOrigin: origin },
    );
    const app = new Hono();
    app.all("/api/*", (c) => api.fetch(c.req.raw));
    app.use(
      "*",
      serveStatic({ root: fileURLToPath(new URL("../.cache/api-build/", import.meta.url)) }),
    );
    await new Promise<void>((resolve, reject) => {
      server = serve(
        { fetch: app.fetch, hostname: "127.0.0.1", port: 4185, overrideGlobalObjects: false },
        () => resolve(),
      );
      server.once("error", reject);
    });
    return cleanup;
  } catch {
    await cleanup();
    throw new Error(
      "Synthetic browser API failed to start. Check TEST_DATABASE_URL and port 4185.",
    );
  }
}
