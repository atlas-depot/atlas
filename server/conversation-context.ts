import { z } from "zod";
import { noteTextSchema } from "../shared/document.ts";
import { conversationRecoveryReasonSchema } from "../shared/conversations.ts";

export const sourceDependenciesSchema = z
  .array(
    z.strictObject({
      noteId: z.uuid().transform((value) => value.toLowerCase()),
      version: z.string().min(1).max(512),
    }),
  )
  .max(1_000);
export type SourceDependency = z.infer<typeof sourceDependenciesSchema>[number];

/** Text ceilings are conservative limits, not character-to-token conversions. */
export const CONTEXT_LIMITS = {
  recentBytes: 8_000,
  /** The runtime schema's 1,300 characters fit this byte limit; the server rechecks bytes. */
  summaryBytes: 4_000,
  promptBytes: 24_000,
  reconstructionBytes: 48_000,
  historyMessages: 500,
  retrievalBytes: 48_000,
  /** A larger single message can never fit a compaction input, so it is never model context. */
  messageBytes: 40_000,
  /** Inherited lineage stays below the 1,000 cap so an attempt can still record retrieval. */
  inheritedSources: 500,
} as const;

export type ContextRecovery = z.infer<typeof conversationRecoveryReasonSchema>;
const summaryTextSchema = noteTextSchema
  .min(1)
  .refine((summary) => byteSize(JSON.stringify(summary)) <= CONTEXT_LIMITS.summaryBytes);
export const summaryResultSchema = z.strictObject({ summary: summaryTextSchema });
export const summaryOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  // UTF-16 units, not bytes: 1,300 units encode to at most 3,900 UTF-8 bytes of plain text.
  properties: { summary: { type: "string", minLength: 1, maxLength: 1_300 } },
} as const;

export type ContextCompactor = {
  allocate(operationId: string): Promise<string>;
  submit(
    sessionId: string,
    operationId: string,
    message: string,
  ): Promise<{ status: "delivered"; deliveryId: string } | { status: "expired" | "rejected" }>;
  inspect(
    sessionId: string,
    deliveryId: string,
  ): Promise<
    | { status: "running" }
    | { status: "failed" }
    | { status: "expired" }
    | { status: "completed"; result: unknown }
  >;
  retire(sessionId: string): Promise<{ status: "ended" | "expired" }>;
};

export function byteSize(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

/** The union without the size check, for callers that drop material instead of failing. */
export function unionDependencies(...sets: readonly SourceDependency[][]): SourceDependency[] {
  const unique = new Map<string, SourceDependency>();
  // Keyed by value, so the same dependency with another property order is not kept twice.
  for (const dependency of sets.flat())
    unique.set(`${dependency.noteId}\n${dependency.version}`, dependency);
  return [...unique.values()].sort(
    (a, b) => a.noteId.localeCompare(b.noteId) || a.version.localeCompare(b.version),
  );
}

export function mergeDependencies(...sets: readonly SourceDependency[][]): SourceDependency[] {
  return sourceDependenciesSchema.parse(unionDependencies(...sets));
}

export type ContextMessage = {
  id: string;
  sequence: number;
  role: "user" | "assistant";
  text: string;
};
export const contextMessagesSchema = z
  .array(
    z.strictObject({
      id: z.uuid(),
      sequence: z.number().int().positive(),
      role: z.enum(["user", "assistant"]),
      text: noteTextSchema,
    }),
  )
  .max(CONTEXT_LIMITS.historyMessages);
export const compactionInputSchema = z.strictObject({
  previousSummary: summaryResultSchema.shape.summary.nullable(),
  messages: contextMessagesSchema,
});

/** Whole messages only: never turn a silently truncated input into an accepted question. */
export function splitContext(messages: ContextMessage[]) {
  let start = messages.length;
  while (start > 0 && byteSize(messages.slice(start - 1)) <= CONTEXT_LIMITS.recentBytes) start--;
  return { older: messages.slice(0, start), recent: messages.slice(start) };
}

/**
 * The compaction input for the newest older messages that fit the budget. Whole earlier
 * messages are left out rather than cut, so one long history cannot block every later turn.
 */
export function compactionInput(previousSummary: string | null, older: ContextMessage[]) {
  const input = (messages: ContextMessage[]) => JSON.stringify({ previousSummary, messages });
  let size = byteSize(input([]));
  let start = older.length;
  while (start > 0) {
    const next = byteSize(older[start - 1]) + 1;
    if (size + next > CONTEXT_LIMITS.reconstructionBytes) break;
    size += next;
    start--;
  }
  return start === older.length ? null : input(older.slice(start));
}

/** Historical content resolves references; only a fresh search can establish answer evidence. */
export function composeContext(
  summary: string | null,
  recent: ContextMessage[],
  question: string,
): string {
  if (!summary && recent.length === 0) return question;
  return `Conversation context (historical, not current source evidence):\n${JSON.stringify({ summary, recent })}\n\nCurrent question:\n${question}`;
}
