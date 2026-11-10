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
import { createNoteIndexStore } from "../server/db/note-index.ts";
import { createNoteIndexJobs } from "../server/db/note-index-jobs.ts";
import { createNoteSearchStore } from "../server/db/note-search.ts";
import { createSearchAdmission } from "../server/db/note-search-admission.ts";
import { createNoteStore } from "../server/db/notes.ts";
import { createOrganizeRunStore } from "../server/db/organize-runs.ts";
import { createDurableOrganizeRuns } from "../server/organize-runs.ts";
import { projectNotePassages } from "../server/passages.ts";
import { EMBEDDING_DIMENSIONS, EMBEDDING_FINGERPRINT } from "../shared/embedding.ts";
import { apiError } from "../shared/http.ts";
import { createAcceptanceOrganizer } from "./organizer-runtime.ts";

const origin = "http://127.0.0.1:4185";
const syntheticRuntimeUrl = "https://synthetic-organizer.example.test";

function account(request: Request) {
  const id = readCookie(request.headers.get("Cookie"), "atlas_session");
  return id && /^test_[a-f0-9]{32}$/.test(id) ? id : null;
}

function syntheticEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  if (tokens.length === 0) {
    vector[0] = 1;
    return vector;
  }
  for (const token of new Set(tokens)) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index++) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const slot = (hash >>> 0) % EMBEDDING_DIMENSIONS;
    vector[slot] += 1;
  }
  const magnitude = Math.hypot(...vector) || 1;
  return vector.map((value) => Number((value / magnitude).toFixed(6)));
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
    const runtime = createAcceptanceOrganizer();
    const organizer = createDurableOrganizeRuns({
      store: createOrganizeRunStore(database.db),
      runtimeUrl: syntheticRuntimeUrl,
      runtimeFor: () => runtime,
      resultRetentionMs: 15 * 60 * 1_000,
    });
    const indexJobs = createNoteIndexJobs(database.db);
    const indexStore = createNoteIndexStore(database.db);
    const searchStore = createNoteSearchStore(database.db);
    const admitSearch = createSearchAdmission(database.db);
    const indexSavedNote = async (noteId: string) => {
      const claim = await indexJobs.claim(noteId, syntheticRuntimeUrl);
      if (!claim) return;
      const runId = `index_${randomUUID()}`;
      const bound = await indexJobs.bind(claim, runId);
      if (!bound) return;
      const version = JSON.stringify(`${bound.note.id}:${bound.revision}`);
      const projection = projectNotePassages({
        noteId: bound.note.id,
        version,
        content: bound.note.content,
      });
      if (projection.status !== "complete" && projection.status !== "empty") return;
      await indexStore.publish(
        bound.ownerId,
        {
          noteId: bound.note.id,
          revision: bound.revision,
          fingerprint: EMBEDDING_FINGERPRINT,
          projection,
          embeddings: projection.passages.map((passage) => syntheticEmbedding(passage.text)),
        },
        { claim, runId },
      );
    };
    const api = createApp(
      async (request) => {
        const userId = account(request);
        return userId ? { userId } : null;
      },
      {
        notes: createNoteStore(database.db),
        organizer,
        indexing: indexJobs,
        search: searchStore,
        admitSearch,
        embedSearch: async (query) => syntheticEmbedding(query),
        onNoteSaved: indexSavedNote,
        authRoutes,
        appOrigin: origin,
      },
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
