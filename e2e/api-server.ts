/** Test-only identity seam. Never imported by production entrypoints or deployed. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { Pool } from "pg";
import { createApp } from "../server/app.ts";
import { evidenceId, type AnswerRuntime } from "../server/conversation-answer.ts";
import { createConversationAnswers } from "../server/conversation-answers.ts";
import type { ContextCompactor } from "../server/conversation-context.ts";
import { readCookie } from "../server/cookies.ts";
import { openDatabase, readTestDatabaseUrl } from "../server/db/connection.ts";
import { createConversationCleanupStore } from "../server/db/conversation-cleanup.ts";
import { createConversationContextStore } from "../server/db/conversation-contexts.ts";
import { conversations, conversationTurns } from "../server/db/conversation-schema.ts";
import { createConversationStore } from "../server/db/conversations.ts";
import { createConversationTurns } from "../server/db/conversation-turns.ts";
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
    const sessionSubmissions = new Map<string, { turnId: string; message: string }>();
    const syntheticCompactor: ContextCompactor = {
      async allocate(operationId) {
        return `summary_${operationId}`;
      },
      async submit(_sessionId, operationId) {
        return { status: "delivered", deliveryId: `summary_delivery_${operationId}` };
      },
      async inspect() {
        return {
          status: "completed",
          result: { summary: "Synthetic compacted conversation context." },
        };
      },
      async retire() {
        return { status: "ended" };
      },
    };
    const syntheticAnswerRuntime: AnswerRuntime = {
      async allocate(operationId) {
        return `answer_${operationId}`;
      },
      async submit(sessionId, operationId, message) {
        sessionSubmissions.set(sessionId, { turnId: operationId, message });
        return {
          status: "delivered",
          sessionId,
          deliveryId: `delivery_${operationId}`,
        };
      },
      async steer(sessionId, operationId, message) {
        const current = sessionSubmissions.get(sessionId);
        sessionSubmissions.set(sessionId, {
          turnId: current?.turnId ?? operationId,
          message: current ? `${current.message}\n${message}` : message,
        });
        return {
          status: "delivered",
          sessionId,
          deliveryId: `steer_${operationId}`,
        };
      },
      async inspect(sessionId) {
        const submitted = sessionSubmissions.get(sessionId);
        if (!submitted || !database) {
          return {
            status: "result",
            evidence: [],
            result: {
              status: "no-support",
              text: "No matching passage was found in your indexed notes.",
              citations: [],
            },
          };
        }
        if (submitted.message.includes("[stay-running]")) {
          return {
            status: "running",
            text: "Drafting partial response before completion...",
          };
        }
        if (submitted.message.includes("[fail-turn]")) {
          return {
            status: "failed",
            text: "Partial output before failure.",
          };
        }
        const [turnOwner] = await database.db
          .select({ ownerId: conversations.ownerId })
          .from(conversationTurns)
          .innerJoin(conversations, eq(conversations.id, conversationTurns.conversationId))
          .where(eq(conversationTurns.id, submitted.turnId));
        if (!turnOwner) {
          return {
            status: "result",
            evidence: [],
            result: {
              status: "no-support",
              text: "No matching passage was found in your indexed notes.",
              citations: [],
            },
          };
        }
        const searchResult = await searchStore.candidates(
          turnOwner.ownerId,
          syntheticEmbedding(submitted.message),
          1,
        );
        const top = searchResult.passages[0];
        if (!top) {
          return {
            status: "result",
            evidence: [],
            result: {
              status: "no-support",
              text: "No matching passage was found in your indexed notes.",
              citations: [],
            },
          };
        }
        const pid = evidenceId(top.source);
        return {
          status: "result",
          evidence: [{ id: pid, text: top.text, source: top.source }],
          result: {
            status: "completed",
            text: `Grounded answer from your notes: ${top.text}`,
            citations: [{ passageId: pid, excerpt: top.text }],
          },
        };
      },
      async retire(sessionId) {
        sessionSubmissions.delete(sessionId);
        return { status: "ended" };
      },
    };
    const conversationAnswers = createConversationAnswers({
      turns: createConversationTurns(database.db),
      cleanup: createConversationCleanupStore(database.db),
      contexts: createConversationContextStore(database.db),
      compactorFor: () => syntheticCompactor,
      runtimeUrl: syntheticRuntimeUrl,
      runtimeFor: () => syntheticAnswerRuntime,
    });
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
        conversations: createConversationStore(database.db),
        answers: conversationAnswers,
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
