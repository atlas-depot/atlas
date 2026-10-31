import type { Client } from "eve/client";
import type { StoredNote } from "../../server/db/notes.ts";
import { createOrganizeRuns } from "../../server/organize-runs.ts";
import { createPrepareOrganizedNote } from "../../server/prepare-organized-note.ts";
import { createEveOrganizer } from "./client.ts";
import type { OrganizerTimeouts } from "./watchdog.ts";

/** One instance per API process. Pass only a private, authenticated eve client. */
export function createOrganizerBackend({
  client,
  readNote,
  timeouts,
  resultRetentionMs,
  cleanupTimeoutMs = 15_000,
}: {
  client: Client;
  readNote: (ownerId: string, noteId: string) => Promise<StoredNote | undefined>;
  timeouts: OrganizerTimeouts;
  resultRetentionMs: number;
  cleanupTimeoutMs?: number;
}) {
  if (
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs < 1 ||
    cleanupTimeoutMs > 2_147_483_647
  ) {
    throw new Error("Organizer cleanup timeout must be a positive timer-safe integer.");
  }
  const prepare = createEveOrganizer({
    client,
    timeouts,
    cleanupSignal: () => AbortSignal.timeout(cleanupTimeoutMs),
  });
  return createOrganizeRuns({
    prepareNote: createPrepareOrganizedNote({ readNote, prepare }),
    resultRetentionMs,
  });
}
