import type { openDatabase } from "../../server/db/connection.ts";
import { createOrganizeRunStore } from "../../server/db/organize-runs.ts";
import { createDurableOrganizeRuns } from "../../server/organize-runs.ts";
import { createDurableEveOrganizer } from "./durable-client.ts";

/** The caller owns the database pool. Requests only dispatch or inspect durable eve work. */
export function createOrganizerBackend({
  db,
  runtimeUrl,
  serviceToken,
  deploymentProtectionSecret,
  resultRetentionMs,
  requestTimeoutMs = 15_000,
}: {
  db: ReturnType<typeof openDatabase>["db"];
  /** Immutable deployment URL, persisted before dispatch so a redeploy cannot redirect an old run. */
  runtimeUrl: string;
  serviceToken: string;
  deploymentProtectionSecret?: string;
  resultRetentionMs: number;
  requestTimeoutMs?: number;
}) {
  return createDurableOrganizeRuns({
    store: createOrganizeRunStore(db),
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
}
