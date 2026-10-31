import {
  ClientError,
  type ClientSession,
  type SendTurnInput,
  type SessionStreamEvent,
} from "eve/client";
import { setTimeout as delay } from "node:timers/promises";
import type { Delivery } from "eve/sessions";
import { researchResultSchema, type ResearchResult } from "./research.ts";

type OrganizerSession = Pick<ClientSession, "cancel" | "end" | "stream">;
type OrganizerClient = {
  sessions: {
    create(input: SendTurnInput): Promise<{ session: OrganizerSession; delivery: Delivery }>;
  };
};

export type PreparedDraft = {
  draft: { markdown: string; sources: ResearchResult["sources"] };
  /** Call only after Atlas has accepted the complete draft. Bind that action to its owner. */
  acknowledge(): Promise<{ status: "ended" | "expired" }>;
};

/** Transport adapter only. HTTP ownership, delivery acknowledgement and abandoned-run recovery are caller responsibilities. */
export function createEveOrganizer({
  client,
  cleanupSignal,
}: {
  client: OrganizerClient;
  cleanupSignal: () => AbortSignal;
}) {
  return async function prepare(
    note: { title: string; content: string },
    {
      signal,
      onProgress,
    }: { signal: AbortSignal; onProgress?: (state: "researching" | "writing") => void },
  ): Promise<PreparedDraft> {
    const throwIfCancelled = () => {
      if (signal.aborted) throw new DOMException("Organization cancelled.", "AbortError");
    };
    throwIfCancelled();
    let accepted;
    try {
      accepted = await client.sessions.create({ message: JSON.stringify(note), signal });
    } catch {
      // A failed creation response does not prove the server did not create a session.
      throw new Error("Organization could not start. Its remote state is unconfirmed.");
    }
    const { session, delivery } = accepted;
    let ending: Promise<{ status: "ended" | "expired" }> | undefined;
    const retire = (reason: string) => {
      ending ??= Promise.resolve().then(async () => {
        try {
          const cleanup = cleanupSignal();
          cleanup.throwIfAborted();
          const receipt = await session.end({ reason, signal: cleanup });
          let result;
          try {
            result = await receipt.result({ signal: cleanup });
          } catch (error) {
            if (isExpired(error)) return { status: "expired" } as const;
            // Retention can remove the receipt before the remaining history is purged.
            return await verifyRetirement(session, cleanupSignal());
          }
          if (result.status !== "completed" || !result.sessionEnded) throw new Error();
          // An ended session requests retention cleanup; it is not proof of physical deletion.
          return { status: "ended" } as const;
        } catch (error) {
          if (isExpired(error)) return { status: "expired" } as const;
          ending = undefined;
          throw new Error("Organization session cleanup is unconfirmed.");
        }
      });
      return ending;
    };

    let turnId: string | undefined;
    try {
      throwIfCancelled();
      const researchCalls = new Set<string>();
      const sources = new Map<string, ResearchResult["sources"][number]>();
      const models = new Map<string, { outcome: string; finishReason?: string }>();
      let replyRunId: string | undefined;
      let completedResearch = false;
      for await (const event of delivery.stream({ signal })) {
        throwIfCancelled();
        if (event.type === "delivery.consumed" && event.data.deliveryId === delivery.deliveryId) {
          turnId = event.data.turnId;
        }
        if (event.scope?.turnId && event.scope.turnId !== turnId) continue;
        if (event.type === "model.settled") {
          models.set(event.data.runId, event.data);
        } else if (
          event.type === "content.completed" &&
          event.data.kind === "text" &&
          event.data.phase === "reply"
        ) {
          replyRunId = event.data.interrupted ? undefined : event.data.runId;
        }
        collectSources(event, researchCalls, sources, () => {
          completedResearch = true;
        });
        if (event.type === "call.requested" && researchCalls.has(event.data.callId)) {
          onProgress?.("researching");
        } else if (event.type === "content.delta" && event.data.kind === "text") {
          onProgress?.("writing");
        }
      }
      const result = await delivery.result({ signal });
      throwIfCancelled();
      const replyModel = replyRunId === undefined ? undefined : models.get(replyRunId);
      if (
        result.status !== "completed" ||
        result.outcome !== "handled" ||
        !result.reply?.trim() ||
        replyModel?.outcome !== "completed" ||
        replyModel.finishReason !== "stop" ||
        (researchCalls.size > 0 && !completedResearch)
      ) {
        throw new Error();
      }
      return {
        draft: { markdown: result.reply, sources: [...sources.values()] },
        acknowledge: () => retire("Atlas accepted the draft"),
      };
    } catch {
      // Aborting a read does not stop accepted eve work. Cancel the isolated run, then retire it.
      try {
        const cleanup = cleanupSignal();
        cleanup.throwIfAborted();
        const cancellation = await session.cancel({ turnId, signal: cleanup });
        await cancellation.result({ signal: cleanup });
      } catch {
        // Terminal retirement below is still attempted if cancellation could not be confirmed.
      }
      await retire("Atlas abandoned the generation");
      throwIfCancelled();
      throw new Error("Organization did not return a complete draft.");
    }
  };
}

function isExpired(error: unknown): boolean {
  return ClientError.is(error) && error.status === 410 && error.code === "session_expired";
}

async function verifyRetirement(
  session: OrganizerSession,
  signal: AbortSignal,
): Promise<{ status: "ended" | "expired" }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    signal.throwIfAborted();
    let hadEvents = false;
    try {
      // Read from zero: an empty tail at the handle's advanced cursor proves nothing.
      for await (const event of session.stream({
        startIndex: 0,
        follow: false,
        reconnect: false,
        signal,
      })) {
        signal.throwIfAborted();
        hadEvents = true;
        if (event.type === "session.ended") return { status: "ended" };
      }
    } catch (error) {
      signal.throwIfAborted();
      if (isExpired(error)) return { status: "expired" };
      throw error;
    }
    signal.throwIfAborted();
    if (!hadEvents) return { status: "expired" };
    if (attempt < 3) await delay(100 * 2 ** attempt, undefined, { signal });
  }
  throw new Error("Session retirement is unconfirmed.");
}

function collectSources(
  event: SessionStreamEvent,
  calls: Set<string>,
  sources: Map<string, ResearchResult["sources"][number]>,
  completed: () => void,
) {
  if (
    event.type === "call.requested" &&
    event.data.capability.kind === "tool" &&
    event.data.capability.name === "research"
  ) {
    calls.add(event.data.callId);
  } else if (
    event.type === "call.settled" &&
    calls.has(event.data.callId) &&
    event.data.outcome === "completed"
  ) {
    const result = researchResultSchema.parse(event.data.output);
    for (const source of result.sources) sources.set(source.url, source);
    completed();
  }
}
