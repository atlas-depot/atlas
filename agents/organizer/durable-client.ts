import { Client, ClientError, type ClientSession, type SessionStreamEvent } from "eve/client";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { generatedDraftSchema, type GeneratedDraft } from "../../server/organize-note.ts";
import { researchResultSchema } from "./research.ts";

const referenceSchema = z.object({
  sessionId: z.string().min(1).max(512),
  deliveryId: z.string().min(1).max(512),
});
export type OrganizerReference = z.infer<typeof referenceSchema>;
export type OrganizerAllocation = { sessionId: string; deliveryId: null };
export type OrganizerObservation =
  | { status: "running"; phase: "starting" | "researching" | "writing" }
  | { status: "draft"; draft: GeneratedDraft; completedAt: number }
  | { status: "cancelled" }
  | { status: "failed"; reason: "generation_failed" | "invalid_draft" | "expired" };

type SessionReader = Pick<ClientSession, "snapshot" | "end">;
type ReaderClient = { sessions: { attach(sessionId: string): SessionReader } };
class ExpiredSubmission extends Error {}

/** Short server requests only. eve owns generation independently of these readers. */
export function createDurableEveOrganizer({
  baseUrl,
  serviceToken,
  deploymentProtectionSecret,
  requestTimeoutMs = 15_000,
  maxModelCalls = 16,
  fetchImpl = fetch,
  client,
}: {
  /** Use an immutable deployment URL for runs that must survive a later deployment. */
  baseUrl: string;
  serviceToken: string;
  deploymentProtectionSecret?: string;
  requestTimeoutMs?: number;
  maxModelCalls?: number;
  fetchImpl?: typeof fetch;
  client?: ReaderClient;
}) {
  const endpoint = new URL(baseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    serviceToken.length < 32
  ) {
    throw new Error("Organizer endpoint or service credential is invalid.");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(maxModelCalls) ||
    maxModelCalls < 1
  ) {
    throw new Error("Organizer request and model-call limits must be positive integers.");
  }
  const url = `${endpoint.href.replace(/\/$/, "")}/eve/v1/session`;
  const deploymentHeaders: Record<string, string> = deploymentProtectionSecret
    ? { "x-vercel-protection-bypass": deploymentProtectionSecret }
    : {};
  const reader =
    client ??
    new Client({
      baseUrl: endpoint.href.replace(/\/$/, ""),
      auth: { basic: { username: "atlas-api", password: serviceToken } },
      headers: deploymentHeaders,
      redirect: "error",
    });

  const post = async (target: string, body: unknown, signal: AbortSignal): Promise<unknown> => {
    const response = await fetchImpl(target, {
      method: "POST",
      headers: {
        ...deploymentHeaders,
        authorization: `Basic ${Buffer.from(`atlas-api:${serviceToken}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    if (response.status !== 202) {
      if (response.status === 409 || response.status === 410) {
        const error = z.object({ code: z.string() }).safeParse(await response.json());
        if (
          error.success &&
          ((response.status === 410 && error.data.code === "session_expired") ||
            (response.status === 409 && error.data.code === "session_not_active"))
        )
          throw new ExpiredSubmission();
      }
      await response.body?.cancel();
      throw new Error();
    }
    return await response.json();
  };

  return {
    async allocate({ operationId }: { operationId: string }): Promise<OrganizerAllocation> {
      if (!operationId || operationId.length > 256)
        throw new Error("Invalid organizer operation ID.");
      try {
        const signal = AbortSignal.timeout(requestTimeoutMs);
        const candidates = new Set<string>();
        for (let attempt = 0; attempt < 5; attempt++) {
          const result = z
            .object({ sessionId: referenceSchema.shape.sessionId })
            .parse(await post(url, { operationId }, signal));
          // Empty creates can race and return different candidate IDs. Seeing a previous ID
          // again confirms the operation now resolves to that canonical owner. No model ran.
          if (candidates.has(result.sessionId))
            return { sessionId: result.sessionId, deliveryId: null };
          candidates.add(result.sessionId);
          if (attempt < 4) await delay(100, undefined, { signal });
        }
        throw new Error();
      } catch {
        throw new Error("Organizer allocation is unconfirmed. No model input was submitted.");
      }
    },

    async submit({
      sessionId,
      operationId,
      note,
    }: {
      sessionId: string;
      operationId: string;
      note: { title: string; content: string };
    }): Promise<OrganizerReference | { status: "expired" }> {
      referenceSchema.shape.sessionId.parse(sessionId);
      if (!operationId || operationId.length > 256)
        throw new Error("Invalid organizer operation ID.");
      // Persist the fixed session ID before calling this. HTTP idempotencyKey is not yet
      // exposed by the 0.91 client serializer. An expired fixed session never starts a replacement.
      try {
        const result = referenceSchema.parse(
          await post(
            `${url}/${encodeURIComponent(sessionId)}`,
            { idempotencyKey: operationId, message: JSON.stringify(note) },
            AbortSignal.timeout(requestTimeoutMs),
          ),
        );
        if (result.sessionId !== sessionId) throw new Error();
        return result;
      } catch (error) {
        if (error instanceof ExpiredSubmission) return { status: "expired" };
        throw new Error("Organizer submission is unconfirmed. Retry the same fixed session only.");
      }
    },

    async inspect(reference: OrganizerReference): Promise<OrganizerObservation> {
      const { sessionId, deliveryId } = referenceSchema.parse(reference);
      try {
        // snapshot pins the durable tail and ends. No live stream or API-process task survives it.
        const snapshot = await reader.sessions.attach(sessionId).snapshot({
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        return observeOrganizer(snapshot.events, deliveryId, maxModelCalls);
      } catch (error) {
        if (expired(error)) return { status: "failed", reason: "expired" };
        throw new Error("Organizer state could not be read. Existing work was not cancelled.");
      }
    },

    async retire(
      reference: OrganizerReference | OrganizerAllocation,
    ): Promise<{ status: "ended" | "expired" }> {
      const sessionId = referenceSchema.shape.sessionId.parse(reference.sessionId);
      const session = reader.sessions.attach(sessionId);
      // Submit end once, then independently verify durable history. A lost end receipt is retryable.
      try {
        await session.end({
          reason: "Atlas retired this draft",
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
      } catch (error) {
        if (expired(error)) return { status: "expired" };
        // Inactive or a lost response alone does not establish completed cleanup.
      }
      try {
        const snapshot = await session.snapshot({ signal: AbortSignal.timeout(requestTimeoutMs) });
        if (snapshot.events.some((event) => event.type === "session.ended"))
          return { status: "ended" };
      } catch (error) {
        if (expired(error)) return { status: "expired" };
      }
      throw new Error("Organizer retirement is unconfirmed. Retry cleanup without starting a run.");
    },
  };
}

function expired(error: unknown): boolean {
  return ClientError.is(error) && error.status === 410 && error.code === "session_expired";
}

/** Read only the accepted delivery's turn; narration, other turns and partial replies are not drafts. */
function observeOrganizer(
  events: readonly SessionStreamEvent[],
  deliveryId: string,
  maxModelCalls: number,
): OrganizerObservation {
  const consumed = events.find(
    (event) => event.type === "delivery.consumed" && event.data.deliveryId === deliveryId,
  );
  const settled = events.find(
    (event) => event.type === "delivery.settled" && event.data.deliveryId === deliveryId,
  );
  const ended = events.some((event) => event.type === "session.ended");
  if (consumed?.type !== "delivery.consumed") {
    return ended || settled
      ? { status: "failed", reason: "generation_failed" }
      : { status: "running", phase: "starting" };
  }
  const turnId = consumed.data.turnId;
  const scoped = events.filter((event) => event.scope?.turnId === turnId);
  const turn = events.find(
    (event) => event.type === "turn.settled" && event.data.turnId === turnId,
  );
  if (turn?.type === "turn.settled" && turn.data.outcome === "cancelled") {
    return { status: "cancelled" };
  }
  const models = new Map<string, Extract<SessionStreamEvent, { type: "model.settled" }>["data"]>();
  const researchCalls = new Set<string>();
  const pendingResearch = new Set<string>();
  const sources = new Map<string, GeneratedDraft["sources"][number]>();
  let completedResearch = false;
  for (const event of scoped) {
    if (event.type === "model.settled") {
      models.set(event.data.runId, event.data);
      if (
        models.size > maxModelCalls ||
        (models.size === maxModelCalls && event.data.finishReason !== "stop")
      ) {
        return { status: "failed", reason: "generation_failed" };
      }
    } else if (
      event.type === "call.requested" &&
      event.data.capability.kind === "tool" &&
      event.data.capability.name === "research"
    ) {
      researchCalls.add(event.data.callId);
      pendingResearch.add(event.data.callId);
    } else if (event.type === "call.settled" && researchCalls.has(event.data.callId)) {
      pendingResearch.delete(event.data.callId);
      if (event.data.outcome === "completed") {
        const result = researchResultSchema.safeParse(event.data.output);
        if (!result.success) return { status: "failed", reason: "invalid_draft" };
        completedResearch = true;
        for (const source of result.data.sources) sources.set(source.url, source);
      }
    }
  }
  if (!settled && !ended) {
    return { status: "running", phase: pendingResearch.size > 0 ? "researching" : "writing" };
  }
  if (
    settled?.type !== "delivery.settled" ||
    settled.data.outcome !== "handled" ||
    settled.data.turnId !== turnId ||
    turn?.type !== "turn.settled" ||
    turn.data.outcome !== "completed" ||
    !turn.data.reply?.length ||
    (researchCalls.size > 0 && !completedResearch)
  ) {
    return { status: "failed", reason: "generation_failed" };
  }
  const parts: string[] = [];
  for (const partId of turn.data.reply) {
    const part = scoped.find(
      (event) => event.type === "content.completed" && event.data.partId === partId,
    );
    if (
      part?.type !== "content.completed" ||
      part.data.kind !== "text" ||
      part.data.phase !== "reply" ||
      part.data.interrupted ||
      typeof part.data.value !== "string"
    ) {
      return { status: "failed", reason: "invalid_draft" };
    }
    const model = models.get(part.data.runId);
    if (model?.outcome !== "completed" || model.finishReason !== "stop") {
      return { status: "failed", reason: "generation_failed" };
    }
    parts.push(part.data.value);
  }
  const draft = generatedDraftSchema.safeParse({
    markdown: parts.join("\n"),
    sources: [...sources.values()],
  });
  const completedAt = Date.parse(turn.meta.at);
  return draft.success && Number.isFinite(completedAt)
    ? { status: "draft", draft: draft.data, completedAt }
    : { status: "failed", reason: "invalid_draft" };
}
