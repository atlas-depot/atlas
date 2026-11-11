import { z } from "zod";
import { noteTextSchema } from "../shared/document.ts";
import { conversationRecoveryReasonSchema } from "../shared/conversations.ts";

export const sourceDependenciesSchema = z
  .array(
    z.strictObject({
      noteId: z.uuid(),
      version: z.string().min(1).max(512),
    }),
  )
  .max(1_000);
export type SourceDependency = z.infer<typeof sourceDependenciesSchema>[number];

/** Byte ceilings are conservative text-input limits, not character-to-token conversions. */
export const CONTEXT_LIMITS = {
  recentBytes: 8_000,
  summaryBytes: 4_000,
  promptBytes: 24_000,
  reconstructionBytes: 48_000,
  historyMessages: 500,
  retrievalBytes: 48_000,
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
  properties: { summary: { type: "string", minLength: 1, maxLength: 4_000 } },
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
    { status: "running" } | { status: "failed" } | { status: "completed"; result: unknown }
  >;
  retire(sessionId: string): Promise<{ status: "ended" | "expired" }>;
};

export function byteSize(value: unknown): number {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

export function mergeDependencies(...sets: readonly SourceDependency[][]): SourceDependency[] {
  const unique = new Map<string, SourceDependency>();
  for (const dependency of sets.flat()) unique.set(JSON.stringify(dependency), dependency);
  return sourceDependenciesSchema.parse(
    [...unique.values()].sort(
      (a, b) => a.noteId.localeCompare(b.noteId) || a.version.localeCompare(b.version),
    ),
  );
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

/** Historical content resolves references; only a fresh search can establish answer evidence. */
export function composeContext(
  summary: string | null,
  recent: ContextMessage[],
  question: string,
): string {
  if (!summary && recent.length === 0) return question;
  return `Conversation context (historical, not current source evidence):\n${JSON.stringify({ summary, recent })}\n\nCurrent question:\n${question}`;
}
