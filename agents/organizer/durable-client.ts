import type { SessionStreamEvent } from "eve/client";
import { z } from "zod";
import {
  generatedDraftSchema,
  type GeneratedDraft,
  type OrganizeUsage,
} from "../../server/organize-note.ts";
import {
  createEveTransport,
  deliveryReceiptSchema,
  expired,
  ExpiredSubmission,
  type ReaderClient,
} from "./eve-transport.ts";
import { API_PRINCIPAL } from "./job.ts";
import { researchResultSchema } from "./research.ts";

const referenceSchema = deliveryReceiptSchema;
export type OrganizerReference = z.infer<typeof referenceSchema>;
export type OrganizerAllocation = { sessionId: string; deliveryId: null };
export type OrganizerObservation = (
  | {
      status: "running";
      phase: "starting" | "researching" | "writing";
      phaseStartedAt?: number;
      lastProgressAt?: number;
    }
  | { status: "draft"; draft: GeneratedDraft; completedAt: number }
  | { status: "cancelled" }
  | { status: "failed"; reason: "generation_failed" | "invalid_draft" | "expired" }
) & { usage?: OrganizeUsage };

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
  if (!Number.isSafeInteger(maxModelCalls) || maxModelCalls < 1) {
    throw new Error("Organizer request and model-call limits must be positive integers.");
  }
  const transport = createEveTransport({
    baseUrl,
    serviceToken,
    username: API_PRINCIPAL,
    deploymentProtectionSecret,
    requestTimeoutMs,
    fetchImpl,
    client,
  });
  const reader = transport.reader;

  return {
    async allocate({ operationId }: { operationId: string }): Promise<OrganizerAllocation> {
      if (!operationId || operationId.length > 256)
        throw new Error("Invalid organizer operation ID.");
      try {
        return { sessionId: await transport.allocate(operationId), deliveryId: null };
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
        return await transport.deliver(sessionId, {
          idempotencyKey: operationId,
          message: JSON.stringify(note),
        });
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
      try {
        return await transport.retire(sessionId, "Atlas retired this draft");
      } catch {
        throw new Error(
          "Organizer retirement is unconfirmed. Retry cleanup without starting a run.",
        );
      }
    },
  };
}

/** Snapshot-derived metadata never advances merely because another reader polled. */
function observeOrganizer(
  events: readonly SessionStreamEvent[],
  deliveryId: string,
  maxModelCalls: number,
): OrganizerObservation {
  const result = observeDraft(events, deliveryId, maxModelCalls);
  const consumed = events.find(
    (event) => event.type === "delivery.consumed" && event.data.deliveryId === deliveryId,
  );
  const scoped =
    consumed?.type === "delivery.consumed"
      ? events.filter((event) => event.scope?.turnId === consumed.data.turnId)
      : [];
  const usage = observeUsage(scoped);
  const progress = result.status === "running" ? observeProgress(events, scoped, deliveryId) : {};
  return { ...result, ...progress, ...(usage ? { usage } : {}) };
}

const reportedUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().safe().optional(),
  outputTokens: z.number().int().nonnegative().safe().optional(),
  costUsd: z.number().nonnegative().optional(),
});
type ReportedUsage = z.infer<typeof reportedUsageSchema>;

/** Count each model run and research call once, never session totals plus their children. */
function observeUsage(events: readonly SessionStreamEvent[]): OrganizeUsage | undefined {
  const models = new Set<string>();
  const research = new Set<string>();
  const settledModels = new Set<string>();
  const settledResearch = new Set<string>();
  const modelUsage = new Map<string, ReportedUsage>();
  const callUsage = new Map<string, ReportedUsage>();
  const researchUsage = new Map<string, ReportedUsage>();
  for (const event of events) {
    if (
      ["model.requested", "model.started", "model.retried", "model.settled"].includes(event.type) &&
      "runId" in event.data &&
      typeof event.data.runId === "string"
    ) {
      models.add(event.data.runId);
      if (event.type === "model.settled") settledModels.add(event.data.runId);
    }
    if (
      event.type === "call.requested" &&
      event.data.capability.kind === "tool" &&
      event.data.capability.name === "research"
    )
      research.add(event.data.callId);
  }
  for (const event of events) {
    if (event.type === "usage.recorded") {
      const parsed = reportedUsageSchema.safeParse(event.data.usage);
      if (!parsed.success) continue;
      const owner = event.data.owner;
      if (owner && "runId" in owner && models.has(owner.runId))
        modelUsage.set(owner.runId, parsed.data);
      else if (owner && "callId" in owner && research.has(owner.callId))
        callUsage.set(owner.callId, parsed.data);
    } else if (event.type === "call.settled" && research.has(event.data.callId)) {
      settledResearch.add(event.data.callId);
      // Preserve reported spend even if source/draft validation subsequently fails.
      const parsed = z.object({ usage: reportedUsageSchema }).safeParse(event.data.output);
      if (parsed.success) researchUsage.set(event.data.callId, parsed.data.usage);
    }
  }
  if (models.size + research.size === 0) return undefined;
  const units = [
    ...[...models].map((id) => modelUsage.get(id)),
    ...[...research].map((id) => callUsage.get(id) ?? researchUsage.get(id)),
  ];
  const totals: OrganizeUsage = {
    complete: settledModels.size === models.size && settledResearch.size === research.size,
  };
  for (const metric of ["inputTokens", "outputTokens", "costUsd"] as const) {
    const reported = units.flatMap((unit) => (unit?.[metric] === undefined ? [] : [unit[metric]]));
    if (reported.length !== units.length) totals.complete = false;
    if (reported.length) {
      const total = reported.reduce((sum, value) => sum + value, 0);
      if (Number.isFinite(total) && (metric === "costUsd" || Number.isSafeInteger(total)))
        totals[metric] = total;
      else totals.complete = false;
    }
  }
  return totals;
}

function observeProgress(
  events: readonly SessionStreamEvent[],
  scoped: readonly SessionStreamEvent[],
  deliveryId: string,
): { phaseStartedAt?: number; lastProgressAt?: number } {
  const admitted = events.find(
    (event) => event.type === "delivery.admitted" && event.data.deliveryId === deliveryId,
  );
  const consumed = events.find(
    (event) => event.type === "delivery.consumed" && event.data.deliveryId === deliveryId,
  );
  const timestamp = (event: SessionStreamEvent | undefined) => {
    const at = event ? Date.parse(event.meta.at) : Number.NaN;
    return Number.isFinite(at) ? at : undefined;
  };
  let phase: "starting" | "researching" | "writing" = consumed ? "writing" : "starting";
  let phaseStartedAt = timestamp(consumed ?? admitted);
  let lastProgressAt = phaseStartedAt;
  const pending = new Set<string>();
  const meaningful = new Set([
    "turn.started",
    "turn.paused",
    "turn.settled",
    "model.requested",
    "model.started",
    "model.retried",
    "model.settled",
    "content.delta",
    "content.completed",
    "call.input",
    "call.requested",
    "call.started",
    "call.progress",
    "call.settled",
  ]);
  for (const event of scoped) {
    const at = timestamp(event);
    if (meaningful.has(event.type) && at !== undefined)
      lastProgressAt = Math.max(lastProgressAt ?? at, at);
    if (
      event.type === "call.requested" &&
      event.data.capability.kind === "tool" &&
      event.data.capability.name === "research"
    )
      pending.add(event.data.callId);
    else if (event.type === "call.settled") pending.delete(event.data.callId);
    const next = pending.size ? "researching" : "writing";
    if (next !== phase) {
      phase = next;
      phaseStartedAt = at;
    }
  }
  return {
    ...(phaseStartedAt === undefined ? {} : { phaseStartedAt }),
    ...(lastProgressAt === undefined ? {} : { lastProgressAt }),
  };
}

/** Read only the accepted delivery's turn; narration, other turns and partial replies are not drafts. */
function observeDraft(
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
        for (const source of result.data.sources)
          sources.set(source.url, { id: source.id, url: source.url, title: source.title });
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
