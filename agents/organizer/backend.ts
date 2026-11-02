import { openDatabase } from "../../server/db/connection.ts";
import { createOrganizeRunStore } from "../../server/db/organize-runs.ts";
import { createDurableOrganizeRuns } from "../../server/organize-runs.ts";
import { createDurableEveOrganizer } from "./durable-client.ts";

/** Own a small pool so bounded runtime waits cannot exhaust the application's note pool. */
export function createOrganizerBackend({
  connectionString,
  runtimeUrl,
  serviceToken,
  deploymentProtectionSecret,
  resultRetentionMs,
  requestTimeoutMs = 15_000,
}: {
  connectionString: string;
  /** Immutable deployment URL, persisted before dispatch so a redeploy cannot redirect an old run. */
  runtimeUrl: string;
  serviceToken: string;
  deploymentProtectionSecret?: string;
  resultRetentionMs: number;
  requestTimeoutMs?: number;
}) {
  const connection = openDatabase(connectionString, { max: 2, lockTimeoutMs: 5_000 });
  const runs = createDurableOrganizeRuns({
    store: createOrganizeRunStore(connection.db),
    runtimeUrl,
    runtimeFor: (baseUrl) =>
      createDurableEveOrganizer({
        baseUrl,
        serviceToken,
        deploymentProtectionSecret,
        requestTimeoutMs,
      }),
    resultRetentionMs,
  });
  return { ...runs, close: connection.close };
}
