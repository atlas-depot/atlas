import { z } from "zod";
import { createConversationAnswers } from "../../server/conversation-answers.ts";
import { openDatabase, readDatabaseUrl } from "../../server/db/connection.ts";
import { createConversationCleanupStore } from "../../server/db/conversation-cleanup.ts";
import { createConversationTurns } from "../../server/db/conversation-turns.ts";
import { createDurableEveAnswerer } from "./answer-client.ts";
import { createDurableEveCompactor } from "./context-client.ts";
import { createConversationContextStore } from "../../server/db/conversation-contexts.ts";
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
  const backend = createOrganizerBackend({
    connectionString: readDatabaseUrl(environment),
    runtimeUrl,
    serviceToken: settings.data.ORGANIZER_SERVICE_TOKEN,
    deploymentProtectionSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
    resultRetentionMs: settings.data.ORGANIZER_RESULT_RETENTION_MS,
  });
  try {
    // Each request is bounded. Keep a single scheduled batch below function duration limits.
    const result = await backend.sweep(5);
    if (result.retryPending > 0)
      throw new Error("Organizer maintenance has retryable pending work.");
    return result;
  } finally {
    await backend.close();
  }
}

/** Continues unobserved answer attempts and retires finished or deleted answer sessions. */
export async function reconcileConversationAnswers(environment: NodeJS.ProcessEnv = process.env) {
  if (environment.ORGANIZER_MAINTENANCE_ENABLED !== "true") return;
  const serviceToken = z.string().min(32).safeParse(environment.ORGANIZER_SERVICE_TOKEN);
  const runtimeUrl =
    environment.ORGANIZER_RUNTIME_URL ??
    (environment.VERCEL_URL ? `https://${environment.VERCEL_URL}` : undefined);
  if (!serviceToken.success || !runtimeUrl)
    throw new Error("Answer maintenance configuration is invalid.");
  const connection = openDatabase(readDatabaseUrl(environment), { max: 2, lockTimeoutMs: 5_000 });
  try {
    const result = await createConversationAnswers({
      turns: createConversationTurns(connection.db),
      cleanup: createConversationCleanupStore(connection.db),
      contexts: createConversationContextStore(connection.db),
      compactorFor: (baseUrl) =>
        createDurableEveCompactor({
          baseUrl,
          serviceToken: serviceToken.data,
          deploymentProtectionSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        }),
      runtimeUrl,
      runtimeFor: (baseUrl) =>
        createDurableEveAnswerer({
          baseUrl,
          serviceToken: serviceToken.data,
          deploymentProtectionSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
        }),
    }).sweep(5);
    if (result.cleanupPending > 0) throw new Error("Answer maintenance has pending cleanup.");
    return result;
  } finally {
    await connection.close();
  }
}
