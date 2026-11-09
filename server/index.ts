import { createNoteIndexJobs } from "./db/note-index-jobs.ts";
import { serve } from "@hono/node-server";
import { WorkOS } from "@workos-inc/node";
import { createApp } from "./app.ts";
import { createAuthRoutes } from "./auth-routes.ts";
import { createRequestAuthenticator } from "./auth.ts";
import { createBrowserAuth } from "./browser-auth.ts";
import { openDatabase } from "./db/connection.ts";
import { createNoteStore } from "./db/notes.ts";
import { readServerEnv } from "./env.ts";
import { createBearerAuthenticator } from "./workos.ts";

async function main() {
  let configuration: ReturnType<typeof readServerEnv>;
  try {
    configuration = readServerEnv(process.env);
  } catch {
    console.error(
      "Atlas API could not start. Check API_PORT, authentication, database and organizer configuration.",
    );
    process.exitCode = 1;
    return;
  }
  const { port, workos, browserAuth } = configuration;
  const workosClient = workos
    ? new WorkOS({
        clientId: workos.clientId,
        issuer: workos.issuer,
        ...(browserAuth ? { apiKey: browserAuth.apiKey } : {}),
      })
    : undefined;
  const browser =
    workosClient && browserAuth ? createBrowserAuth(workosClient, browserAuth) : undefined;
  const authenticateRequest = createRequestAuthenticator(
    workosClient ? createBearerAuthenticator(workosClient) : undefined,
    browser?.authenticate,
  );
  // Load the isolated eve adapter only when this API is configured to use it.
  const organizer = configuration.organizer
    ? (await import("../agents/organizer/backend.ts")).createOrganizerBackend(
        configuration.organizer,
      )
    : undefined;
  const database = configuration.databaseUrl ? openDatabase(configuration.databaseUrl) : undefined;
  const indexingClient = configuration.organizer
    ? (await import("../agents/organizer/index-client.ts")).createNoteIndexClient({
        baseUrl: configuration.organizer.runtimeUrl,
        serviceToken: configuration.organizer.serviceToken,
        deploymentProtectionSecret: configuration.organizer.deploymentProtectionSecret,
      })
    : undefined;
  const closeDatabases = async () => {
    await Promise.all([database?.close(), organizer?.close()]);
  };
  const app = createApp(authenticateRequest, {
    notes: database ? createNoteStore(database.db) : undefined,
    organizer,
    indexing: database ? createNoteIndexJobs(database.db) : undefined,
    onNoteSaved: indexingClient ? (noteId) => indexingClient.start(noteId) : undefined,
    appOrigin: browserAuth?.appOrigin,
    authRoutes:
      browser && browserAuth
        ? createAuthRoutes(browser, { appOrigin: browserAuth.appOrigin })
        : undefined,
  });
  const server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port, overrideGlobalObjects: false },
    (address) => console.log(`Atlas API listening on http://127.0.0.1:${address.port}`),
  );
  server.on("error", () => {
    if (server.listening) {
      console.error("Atlas API server error.");
    } else {
      console.error("Atlas API could not start. Check API_PORT and port availability.");
      process.exitCode = 1;
      void closeDatabases().catch(() => {
        console.error("Atlas API database shutdown failed.");
        process.exitCode = 1;
      });
    }
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 5_000);
    deadline.unref();
    server.close(async (error) => {
      try {
        await closeDatabases();
      } catch {
        process.exitCode = 1;
      }
      clearTimeout(deadline);
      if (error) process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch(() => {
  console.error(
    "Atlas API could not start. Check authentication, database and organizer configuration.",
  );
  process.exitCode = 1;
});
