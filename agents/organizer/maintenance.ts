import { z } from "zod";
import { openDatabase, readDatabaseUrl } from "../../server/db/connection.ts";
import { createOrganizerBackend } from "./backend.ts";

/** Maintenance is explicit per environment; previews never sweep shared data by default. */
export async function reconcileOrganizerRuns(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.ORGANIZER_MAINTENANCE_ENABLED !== "true") return;
  const settings = z
    .object({
      ORGANIZER_SERVICE_TOKEN: z.string().min(32),
      ORGANIZER_RESULT_RETENTION_MS: z.coerce.number().int().positive().default(900_000),
    })
    .safeParse(environment);
  const runtimeUrl =
    environment.ORGANIZER_RUNTIME_URL ??
    (environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : undefined);
  if (!settings.success || !runtimeUrl)
    throw new Error("Organizer maintenance configuration is invalid.");
  const connection = openDatabase(readDatabaseUrl(environment));
  try {
    const backend = createOrganizerBackend({
      db: connection.db,
      runtimeUrl,
      serviceToken: settings.data.ORGANIZER_SERVICE_TOKEN,
      deploymentProtectionSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
      resultRetentionMs: settings.data.ORGANIZER_RESULT_RETENTION_MS,
    });
    // Each request is bounded. Keep a single scheduled batch below function duration limits.
    const result = await backend.sweep(5);
    if (result.retryPending > 0)
      throw new Error("Organizer maintenance has retryable pending work.");
    return result;
  } finally {
    await connection.close();
  }
}
