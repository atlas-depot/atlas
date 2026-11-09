import { start } from "eve/workflow/api";
import { z } from "zod";
import { openDatabase, readDatabaseUrl } from "../../server/db/connection.ts";
import { createNoteIndexJobs } from "../../server/db/note-index-jobs.ts";
import { indexRuntimeUrlSchema } from "../../shared/index-jobs.ts";
import { createNoteIndexClient } from "./index-client.ts";
import { createIndexCoordinator } from "./index-coordinator.ts";
import { indexNoteWorkflow } from "./index-workflow.ts";

export function createIndexRuntime(environment: NodeJS.ProcessEnv = process.env) {
  const runtimeUrl = indexRuntimeUrlSchema.safeParse(
    environment.ORGANIZER_RUNTIME_URL ??
      (environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : undefined),
  );
  const serviceToken = z.string().min(32).safeParse(environment.ORGANIZER_SERVICE_TOKEN);
  if (!runtimeUrl.success || !serviceToken.success)
    throw new Error("Note index runtime configuration is invalid.");
  const connection = openDatabase(readDatabaseUrl(environment), { max: 1, lockTimeoutMs: 5_000 });
  const coordinator = createIndexCoordinator({
    jobs: createNoteIndexJobs(connection.db),
    runtimeUrl: runtimeUrl.data,
    startRun: async (claim) => (await start(indexNoteWorkflow, [claim])).runId,
    status: (baseUrl, runId) =>
      createNoteIndexClient({
        baseUrl,
        serviceToken: serviceToken.data,
        deploymentProtectionSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      }).status(runId),
  });
  return { ...coordinator, close: connection.close };
}

export async function reconcileNoteIndexes(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.ORGANIZER_MAINTENANCE_ENABLED !== "true") return;
  const runtime = createIndexRuntime(environment);
  try {
    const result = await runtime.sweep(5);
    if (result.uncertain > 0) throw new Error("Note index maintenance has uncertain work.");
    return result;
  } finally {
    await runtime.close();
  }
}
