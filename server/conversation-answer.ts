import { createHash } from "node:crypto";
import { z } from "zod";
import { noteTextSchema } from "../shared/document.ts";
import { notePassageSourceSchema, type NotePassageSource } from "../shared/passages.ts";

/** Evidence the server itself returned to the model during one attempt. */
export type AnswerEvidence = { id: string; text: string; source: NotePassageSource };

/** What one bounded read of the runtime shows. `result` is still unvalidated model output. */
export type AnswerObservation =
  | { status: "running"; text: string }
  | { status: "result"; result: unknown; evidence: AnswerEvidence[] }
  | { status: "cancelled"; text: string }
  | { status: "failed"; text: string };
export type AnswerDelivery =
  | { status: "delivered"; sessionId: string; deliveryId: string }
  | { status: "expired" };
/** The private runtime as the API sees it. Every call is short and safe to repeat. */
export type AnswerRuntime = {
  allocate(operationId: string): Promise<string>;
  submit(sessionId: string, operationId: string, message: string): Promise<AnswerDelivery>;
  steer(sessionId: string, operationId: string, message: string): Promise<AnswerDelivery>;
  inspect(
    sessionId: string,
    deliveries: { deliveryId: string; steerDeliveryIds: readonly string[] },
  ): Promise<AnswerObservation>;
  retire(sessionId: string): Promise<{ status: "ended" | "expired" }>;
};

const passageIdSchema = z.string().regex(/^p_[0-9a-f]{16}$/);
const answerTextSchema = noteTextSchema.refine(
  (text) => text.trim().length > 0 && text.length <= 100_000,
);

const citationSchema = z.strictObject({
  passageId: passageIdSchema,
  excerpt: noteTextSchema.refine((text) => text.length > 0 && text.length <= 1_000),
});

/**
 * The only shape a model may return. One flat object keeps the runtime's reply schema
 * portable across providers. A valid shape is not yet a supported answer.
 */
export const answerResultSchema = z
  .strictObject({
    status: z.enum(["completed", "no-support"]),
    text: answerTextSchema,
    citations: z.array(citationSchema).max(100),
  })
  .refine((result) => (result.status === "completed") === result.citations.length > 0);
export type AnswerResult = z.infer<typeof answerResultSchema>;

/** JSON Schema sent with the input so the runtime constrains the reply to this shape. */
export const answerOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "text", "citations"],
  properties: {
    status: {
      type: "string",
      enum: ["completed", "no-support"],
      description:
        "completed only when retrieved passages support the answer; otherwise no-support.",
    },
    text: { type: "string", minLength: 1 },
    citations: {
      type: "array",
      maxItems: 100,
      description: "Empty for no-support. At least one for completed.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["passageId", "excerpt"],
        properties: {
          passageId: { type: "string", description: "The id of a passage search_notes returned." },
          excerpt: {
            type: "string",
            minLength: 1,
            maxLength: 1000,
            description: "Text copied exactly from that passage.",
          },
        },
      },
    },
  },
} as const;

/** Stable for one source location and revision, so repeated searches name a passage once. */
export function evidenceId(source: NotePassageSource): string {
  const canonical = notePassageSourceSchema.parse(source);
  const key = JSON.stringify(
    Object.keys(canonical)
      .sort()
      .map((name) => [name, canonical[name as keyof NotePassageSource]]),
  );
  return `p_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`;
}

const searchOutputSchema = z.object({
  passages: z
    .array(z.object({ id: z.string(), text: z.string().min(1), source: notePassageSourceSchema }))
    .max(10),
});

/** Reads one recorded search result. The passage ID is recomputed, never taken on trust. */
export function readSearchEvidence(output: unknown): AnswerEvidence[] | undefined {
  const parsed = searchOutputSchema.safeParse(output);
  if (!parsed.success) return undefined;
  return parsed.data.passages.map(({ text, source }) => ({
    id: evidenceId(source),
    text,
    source,
  }));
}

export type ResolvedAnswer =
  | {
      status: "completed";
      text: string;
      citations: { source: NotePassageSource; excerpt: string; deleted: false }[];
    }
  | { status: "no-support"; text: string; citations: [] };
export type AnswerRejection = "malformed_result" | "unknown_source" | "excerpt_mismatch";

/**
 * Checks identity and provenance only: every citation must name a passage this attempt
 * actually retrieved and quote it exactly. It does not judge whether the claim is supported.
 */
export function resolveAnswer(
  result: unknown,
  evidence: readonly AnswerEvidence[],
): { ok: true; answer: ResolvedAnswer } | { ok: false; reason: AnswerRejection } {
  const parsed = answerResultSchema.safeParse(result);
  if (!parsed.success) return { ok: false, reason: "malformed_result" };
  if (parsed.data.status === "no-support")
    return { ok: true, answer: { status: "no-support", text: parsed.data.text, citations: [] } };
  const known = new Map(evidence.map((passage) => [passage.id, passage]));
  const citations: { source: NotePassageSource; excerpt: string; deleted: false }[] = [];
  const seen = new Set<string>();
  for (const citation of parsed.data.citations) {
    const passage = known.get(citation.passageId);
    if (!passage) return { ok: false, reason: "unknown_source" };
    if (!passage.text.includes(citation.excerpt)) return { ok: false, reason: "excerpt_mismatch" };
    const key = `${citation.passageId}\n${citation.excerpt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({ source: passage.source, excerpt: citation.excerpt, deleted: false });
  }
  return { ok: true, answer: { status: "completed", text: parsed.data.text, citations } };
}
