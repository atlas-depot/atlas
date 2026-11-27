import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { Pool } from "pg";
import { createApp } from "../../server/app.ts";
import { readCookie } from "../../server/cookies.ts";
import { openDatabase, readTestDatabaseUrl } from "../../server/db/connection.ts";
import { createConversationStore } from "../../server/db/conversations.ts";
import { createNoteStore } from "../../server/db/notes.ts";
import { createOrganizeRunStore } from "../../server/db/organize-runs.ts";
import { notes } from "../../server/db/schema.ts";
import { createDurableOrganizeRuns } from "../../server/organize-runs.ts";
import { apiError } from "../../shared/http.ts";
import { expectEditorContent } from "../../e2e/notes-editor.ts";

const USER_COUNT = Number(process.env.PERF_USERS ?? 10);
const NOTES_PER_USER = Number(process.env.PERF_NOTES ?? 1000);
const ITERATIONS = Number(process.env.PERF_ITERATIONS ?? 20);
const WARMUP = Number(process.env.PERF_WARMUP ?? 2);
const COLD_SAMPLES = Number(process.env.PERF_COLD ?? 40);
const WARM_SAMPLES = Number(process.env.PERF_WARM ?? 40);
const PORT = Number(process.env.PERF_PORT ?? 4190);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const DIST_INDEX = fileURLToPath(new URL("../../dist/index.html", import.meta.url));

type Sample = { ms: number; user: string; note: string; iteration: number };
type FailureOp =
  | "open"
  | "save"
  | "verify"
  | "request"
  | "initial-cold"
  | "initial-warm"
  | "ownership"
  | "worker";
type Failure = {
  op: FailureOp;
  user: string;
  note?: string;
  phase?: string;
  message: string;
  status?: number;
};

function percentile(sorted: number[], fraction: number) {
  return sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stats(values: number[], targetMs: number, errors: number, expectedSamples: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  return {
    samples: sorted.length,
    expectedSamples,
    errors,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 0.5),
    p95,
    max: sorted.at(-1) ?? null,
    overTarget: sorted.filter((value) => value > targetMs).length,
    targetMs,
    // A scenario only passes when the measurement is complete and no sample is over target.
    passed: errors === 0 && sorted.length === expectedSamples && p95 !== null && p95 <= targetMs,
  };
}

function noteContent(user: string, index: number, revision = 0) {
  return `OWNER=${user} NOTE=${String(index).padStart(4, "0")} REV=${revision} ${"Synthetic note body for load testing. ".repeat(40)}`;
}

function noteTitle(user: string, index: number, revision = 0) {
  return `Perf ${user} ${String(index).padStart(4, "0")} r${revision}`;
}

async function measureInitialView(page: Page) {
  const start = performance.now();
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await expect(title).toBeEditable({ timeout: 30_000 });
  await expect(title).not.toHaveValue("");
  return performance.now() - start;
}

test("measures note open, save and initial workspace latency", async ({ browser }, testInfo) => {
  test.setTimeout(30 * 60_000);
  if (!existsSync(DIST_INDEX))
    throw new Error("Build the production bundle first: VITE_NOTES_DEMO=false pnpm build.");
  if (USER_COUNT < 2)
    throw new Error("PERF_USERS must be at least 2 so the cross-account check has another user.");
  if (NOTES_PER_USER < 2)
    throw new Error("PERF_NOTES must be at least 2 so each measured open switches notes.");

  const databaseUrl = new URL(readTestDatabaseUrl(process.env));
  const databaseName = `atlas_perf_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({
    connectionString: databaseUrl.toString(),
    connectionTimeoutMillis: 10_000,
  });
  let database: ReturnType<typeof openDatabase> | undefined;
  let server: ReturnType<typeof serve> | undefined;
  const failures: Failure[] = [];
  const openSamples: Sample[] = [];
  const saveSamples: Sample[] = [];
  const saveUiSamples: Sample[] = [];
  const initialCold: number[] = [];
  const initialWarm: number[] = [];
  const checks = {
    ownerMarkers: 0,
    reopened: 0,
    foreignDenied: 0,
    notes: 0,
    unexpectedRequests: 0,
  };
  const runStarted = performance.now();
  let loadWindowMs = 0;
  let initialWindowMs = 0;
  let revision = "unknown";
  let browserVersion = "unknown";
  let databaseVersion = "unknown";
  let seedMs = 0;

  try {
    revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    databaseUrl.pathname = `/${databaseName}`;
    database = openDatabase(databaseUrl.toString());
    await migrate(database.db, {
      migrationsFolder: fileURLToPath(new URL("../../drizzle/", import.meta.url)),
    });
    databaseVersion = (
      (await database.db.execute("select version() as version")).rows[0] as { version: string }
    ).version;
    browserVersion = browser.version();

    const users = Array.from(
      { length: USER_COUNT },
      (_, index) => `perf_user_${String(index + 1).padStart(2, "0")}`,
    );
    // This user is not edited during the load phase, so its first list row stays stable.
    const viewUser = "perf_view";
    const seededUsers = [...users, viewUser];
    const userNotes = new Map<
      string,
      Array<{ id: string; title: string; content: string; index: number }>
    >();
    const seedStarted = performance.now();
    for (const [userIndex, user] of seededUsers.entries()) {
      const rows = Array.from({ length: NOTES_PER_USER }, (_, index) => ({
        id: randomUUID(),
        ownerId: user,
        title: noteTitle(user, index),
        content: noteContent(user, index),
        createdAt: "2026-11-27T00:00:00.000Z",
        updatedAt: "2026-11-27T00:00:00.000Z",
      }));
      userNotes.set(
        user,
        rows.map((row, index) => ({
          id: row.id,
          title: row.title,
          content: row.content,
          index,
        })),
      );
      for (let offset = 0; offset < rows.length; offset += 500)
        await database.db.insert(notes).values(rows.slice(offset, offset + 500));
      if (userIndex === 0 && rows.length !== NOTES_PER_USER)
        throw new Error("Seed count mismatch.");
    }
    checks.notes = seededUsers.length * NOTES_PER_USER;
    seedMs = performance.now() - seedStarted;

    const authRoutes = new Hono();
    authRoutes.get("/session", (c) => {
      const id = readCookie(c.req.header("Cookie") ?? null, "atlas_session");
      return id && seededUsers.includes(id)
        ? c.json({
            user: {
              id,
              email: `${id}@example.test`,
              firstName: "Performance",
              lastName: null,
            },
          })
        : c.json(apiError("UNAUTHENTICATED", "Synthetic performance session required."), 401);
    });
    const api = createApp(
      async (request) => {
        const id = readCookie(request.headers.get("Cookie"), "atlas_session");
        return id && seededUsers.includes(id) ? { userId: id } : null;
      },
      {
        notes: createNoteStore(database.db),
        conversations: createConversationStore(database.db),
        // Serve the reconnect listing from the disposable database; the AI runtime stays off.
        organizer: createDurableOrganizeRuns({
          store: createOrganizeRunStore(database.db),
          runtimeUrl: ORIGIN,
          runtimeFor: () => {
            throw new Error("The load harness does not run the organizer runtime.");
          },
          resultRetentionMs: 1_800_000,
        }),
        authRoutes,
        appOrigin: ORIGIN,
      },
    );
    const app = new Hono();
    app.all("/api/*", (c) => api.fetch(c.req.raw));
    app.use("/assets/*", async (c, next) => {
      await next();
      c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    const staticRoot = fileURLToPath(new URL("../../dist/", import.meta.url));
    app.use("*", serveStatic({ root: staticRoot }));
    // Mirror the production /notes/:id rewrite so a reload reaches the SPA shell.
    app.get("/notes/*", serveStatic({ root: staticRoot, path: "index.html" }));
    await new Promise<void>((resolve, reject) => {
      server = serve(
        { fetch: app.fetch, hostname: "127.0.0.1", port: PORT, overrideGlobalObjects: false },
        () => resolve(),
      );
      server.once("error", reject);
    });

    const contextOptions = {
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    } as const;

    // Unexpected same-origin errors make a phase pass while the page shows a failure state.
    const trackUnexpectedRequests = (page: Page, phase: string) => {
      const record = (message: string, status?: number) => {
        checks.unexpectedRequests += 1;
        failures.push({ op: "request", user: "page", phase, message, status });
      };
      page.on("response", (response) => {
        if (response.status() < 400) return;
        const url = new URL(response.url());
        if (url.origin !== ORIGIN || url.pathname === "/favicon.ico") return;
        record(`unexpected ${response.status()} for ${url.pathname}`, response.status());
      });
      page.on("requestfailed", (request) => {
        const message = request.failure()?.errorText ?? "network failure";
        if (message.includes("ERR_ABORTED")) return;
        const url = new URL(request.url());
        if (url.origin !== ORIGIN) return;
        record(`${message} for ${url.pathname}`);
      });
    };

    const pages = await Promise.all(
      users.map(async (user) => {
        const context = await browser.newContext(contextOptions);
        await context.addCookies([
          { name: "atlas_session", value: user, url: ORIGIN, httpOnly: true, sameSite: "Lax" },
        ]);
        const page = await context.newPage();
        trackUnexpectedRequests(page, "load");
        await page.goto(ORIGIN);
        await expect(page.getByRole("button", { name: "New note", exact: true })).toBeEnabled({
          timeout: 30_000,
        });
        const first = userNotes.get(user)![0]!;
        await expect(page.getByRole("button", { name: first.title, exact: true })).toBeVisible({
          timeout: 30_000,
        });
        return { user, context, page };
      }),
    );

    const editor = (page: Page) =>
      page.getByRole("textbox", { name: /^(Note content|Markdown source)$/ }).first();
    const titleInput = (page: Page) => page.getByRole("textbox", { name: "Title", exact: true });
    const status = (page: Page) => page.getByRole("status").first();

    const loadWindowStarted = performance.now();
    const workerResults = await Promise.allSettled(
      pages.map(async ({ user, context, page }, userIndex) => {
        const userNoteList = userNotes.get(user)!;
        let lastSaved: { title: string; content: string } | null = null;
        for (let iteration = 0; iteration < ITERATIONS + WARMUP; iteration++) {
          // Consecutive notes per user: every measured open switches away from the saved note.
          const noteIndex = (iteration + userIndex * 7) % NOTES_PER_USER;
          const note = userNoteList[noteIndex]!;
          const nextTitle = noteTitle(user, note.index, iteration + 1);
          const nextContent = noteContent(user, note.index, iteration + 1);
          try {
            const openStart = performance.now();
            await page.getByRole("button", { name: note.title, exact: true }).click();
            await expect(titleInput(page)).toHaveValue(note.title, { timeout: 20_000 });
            await expectEditorContent(editor(page), new RegExp(`OWNER=${user} NOTE=`));
            checks.ownerMarkers += 1;
            if (iteration >= WARMUP)
              openSamples.push({
                ms: performance.now() - openStart,
                user,
                note: note.title,
                iteration,
              });
          } catch (error) {
            failures.push({ op: "open", user, note: note.title, message: describeError(error) });
            continue;
          }

          let saveStartedAt: number;
          try {
            await titleInput(page).fill(nextTitle);
            await editor(page).fill(nextContent);
            await expect(status(page)).toHaveText("Unsaved changes", { timeout: 10_000 });
            saveStartedAt = performance.now();
            await page.keyboard.press("ControlOrMeta+s");
            await expect(status(page)).toHaveText("Saved", { timeout: 20_000 });
            if (iteration >= WARMUP)
              saveUiSamples.push({
                ms: performance.now() - saveStartedAt,
                user,
                note: nextTitle,
                iteration,
              });
            note.title = nextTitle;
            note.content = nextContent;
            lastSaved = { title: nextTitle, content: nextContent };
          } catch (error) {
            failures.push({ op: "save", user, note: nextTitle, message: describeError(error) });
            continue;
          }

          try {
            const read = await context.request.get(`${ORIGIN}/api/notes/${note.id}`);
            if (read.status() !== 200) throw new Error(`saved note read ${read.status()}`);
            const saved = (await read.json()) as { title: string; content: string };
            if (saved.title !== nextTitle || !saved.content.includes(nextContent.slice(0, 80)))
              throw new Error("saved note content mismatch");
            checks.reopened += 1;
            if (iteration >= WARMUP)
              saveSamples.push({
                ms: performance.now() - saveStartedAt,
                user,
                note: nextTitle,
                iteration,
              });
          } catch (error) {
            failures.push({ op: "verify", user, note: nextTitle, message: describeError(error) });
          }
        }
        if (lastSaved) {
          await page.reload();
          await expect(titleInput(page)).toBeEditable({ timeout: 30_000 });
          await page.getByRole("button", { name: lastSaved.title, exact: true }).click();
          await expectEditorContent(editor(page), new RegExp(lastSaved.content.slice(0, 80)));
          checks.reopened += 1;
        }
        const foreign = userNotes.get(users[(userIndex + 1) % users.length]!)![0]!;
        const denied = await context.request.get(`${ORIGIN}/api/notes/${foreign.id}`);
        if (denied.status() === 404) checks.foreignDenied += 1;
        else
          failures.push({
            op: "ownership",
            user,
            note: foreign.id,
            message: `expected 404, got ${denied.status()}`,
            status: denied.status(),
          });
      }),
    );
    for (const result of workerResults)
      if (result.status === "rejected")
        failures.push({
          op: "worker",
          user: "unknown",
          message: describeError(result.reason),
        });
    loadWindowMs = performance.now() - loadWindowStarted;
    await Promise.all(pages.map(({ context }) => context.close()));

    const initialWindowStarted = performance.now();
    const throttledOptions = { ...contextOptions } as const;
    const network = {
      downloadThroughput: 10_000_000 / 8,
      uploadThroughput: 10_000_000 / 8,
      latency: 0,
      offline: false,
    };
    const applyNetwork = async (context: BrowserContext, page: Page) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", network);
    };

    for (let sample = 0; sample < COLD_SAMPLES; sample++) {
      const context = await browser.newContext(throttledOptions);
      try {
        await context.addCookies([
          {
            name: "atlas_session",
            value: viewUser,
            url: ORIGIN,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const page = await context.newPage();
        trackUnexpectedRequests(page, "initial-cold");
        await applyNetwork(context, page);
        initialCold.push(await measureInitialView(page));
      } catch (error) {
        failures.push({
          op: "initial-cold",
          user: viewUser,
          message: describeError(error),
        });
      } finally {
        await context.close();
      }
    }

    const warmContext = await browser.newContext(throttledOptions);
    try {
      await warmContext.addCookies([
        { name: "atlas_session", value: viewUser, url: ORIGIN, httpOnly: true, sameSite: "Lax" },
      ]);
      let warmPage: Page | null = null;
      try {
        warmPage = await warmContext.newPage();
        trackUnexpectedRequests(warmPage, "initial-warm");
        await applyNetwork(warmContext, warmPage);
        await measureInitialView(warmPage);
      } catch (error) {
        failures.push({
          op: "initial-warm",
          user: viewUser,
          message: `primer failed: ${describeError(error)}`,
        });
        warmPage = null;
      }
      for (let sample = 0; warmPage && sample < WARM_SAMPLES; sample++) {
        try {
          initialWarm.push(await measureInitialView(warmPage));
        } catch (error) {
          failures.push({
            op: "initial-warm",
            user: viewUser,
            message: describeError(error),
          });
        }
      }
    } finally {
      await warmContext.close();
    }
    initialWindowMs = performance.now() - initialWindowStarted;

    const openTimes = openSamples.map((sample) => sample.ms);
    const saveTimes = saveSamples.map((sample) => sample.ms);
    const saveUiTimes = saveUiSamples.map((sample) => sample.ms);
    const failureCount = (op: FailureOp) => failures.filter((failure) => failure.op === op).length;
    const expectedOpenSamples = USER_COUNT * ITERATIONS;
    const expectedSaveSamples = USER_COUNT * ITERATIONS;
    const result = {
      meta: {
        revision,
        origin: ORIGIN,
        users: USER_COUNT,
        initialViewUser: viewUser,
        seededUsers: seededUsers.length,
        notesPerUser: NOTES_PER_USER,
        iterationsPerUser: ITERATIONS,
        warmupIterations: WARMUP,
        noteBytes: noteContent("perf_user_01", 0).length,
        seedMs,
        database: databaseVersion,
        node: process.version,
        browser: browserVersion,
        platform: process.platform,
        arch: process.arch,
        cpu: cpus()[0]?.model,
        totalMemoryBytes: totalmem(),
        apiProcesses: 1,
        poolMax: 5,
        networkMbps: 10,
        networkLatencyMs: 0,
        viewport: contextOptions.viewport,
        coldSamples: COLD_SAMPLES,
        warmSamples: WARM_SAMPLES,
        loadWindowMs,
        initialWindowMs,
        totalMs: performance.now() - runStarted,
        requestMix: "1 open + 1 save per iteration; initial view separate; no AI or connectors",
        timing: {
          open: "note click to title and owner content assertions",
          save: "ControlOrMeta+S to Saved plus a successful read-back",
          saveUi: "ControlOrMeta+S to Saved",
          initialView: "navigation to an editable non-empty title",
        },
        cache:
          "fresh context for cold; same context for warm; hashed assets immutable; API no-store",
      },
      checks,
      failures,
      open: stats(openTimes, 2_000, failureCount("open"), expectedOpenSamples),
      save: stats(saveTimes, 2_000, failureCount("save"), expectedSaveSamples),
      saveUi: stats(saveUiTimes, 2_000, failureCount("save"), expectedSaveSamples),
      initialCold: stats(initialCold, 3_000, failureCount("initial-cold"), COLD_SAMPLES),
      initialWarm: stats(initialWarm, 3_000, failureCount("initial-warm"), WARM_SAMPLES),
      raw: { openSamples, saveSamples, saveUiSamples, initialCold, initialWarm },
    };
    const resultPath = process.env.PERF_RESULT ?? testInfo.outputPath("perf-results.json");
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(
      JSON.stringify(
        {
          meta: result.meta,
          checks,
          failures,
          open: result.open,
          save: result.save,
          saveUi: result.saveUi,
          initialCold: result.initialCold,
          initialWarm: result.initialWarm,
        },
        null,
        2,
      ),
    );

    // Results are written before these assertions so a failed run keeps its evidence.
    // Latency above a target is reported through `passed` and does not fail the run;
    // operation errors and missing samples do.
    expect.soft(failures.length, `recorded failures (${resultPath})`).toBe(0);
    expect.soft(openSamples.length, "open samples").toBe(expectedOpenSamples);
    expect.soft(saveSamples.length, "save samples").toBe(expectedSaveSamples);
    expect.soft(saveUiSamples.length, "save UI samples").toBe(expectedSaveSamples);
    expect.soft(initialCold.length, "cold initial-view samples").toBe(COLD_SAMPLES);
    expect.soft(initialWarm.length, "warm initial-view samples").toBe(WARM_SAMPLES);
    expect.soft(checks.ownerMarkers, "owner-marked opens").toBe(USER_COUNT * (ITERATIONS + WARMUP));
    expect
      .soft(checks.reopened, "save read-backs and UI reopens")
      .toBe(USER_COUNT * (ITERATIONS + WARMUP) + USER_COUNT);
    expect.soft(checks.foreignDenied, "cross-account denials").toBe(USER_COUNT);
  } finally {
    if (server?.listening)
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
        if ("closeAllConnections" in server!)
          (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
      });
    await database?.close();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
});
