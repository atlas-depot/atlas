import { z } from "zod";
import type { StoredNote } from "./db/notes.ts";

const sourceUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.username === "" && url.password === "";
});

/** Source records come from the research adapter, never from model-written links. */
export const generatedDraftSchema = z.strictObject({
  // Derivatives must fit the existing Markdown note contract used by explicit Save.
  markdown: z
    .string()
    .max(100_000)
    .refine((value) => value.trim().length > 0),
  sources: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        url: sourceUrlSchema,
        title: z.string(),
        imageUrl: sourceUrlSchema.optional(),
      }),
    )
    .refine((sources) => new Set(sources.map((source) => source.id)).size === sources.length),
});

export type GeneratedDraft = z.infer<typeof generatedDraftSchema>;
export class GenerationCleanupError extends Error {
  readonly retryCleanup: () => Promise<{ status: "ended" | "expired" }>;

  constructor(retryCleanup: () => Promise<{ status: "ended" | "expired" }>) {
    super("Generation session cleanup is unconfirmed.");
    this.name = "GenerationCleanupError";
    this.retryCleanup = retryCleanup;
  }
}
export type DraftGenerator = (
  note: { title: string; content: string },
  options: { signal: AbortSignal },
) => Promise<unknown>;

export type OrganizeNoteResult =
  | {
      status: "draft";
      draft: GeneratedDraft;
      source: { noteId: string; revision: number; stale: boolean };
    }
  | { status: "not_found" }
  | { status: "cancelled" }
  | {
      status: "failed";
      reason: "cleanup_failed";
      retryCleanup: GenerationCleanupError["retryCleanup"];
    }
  | { status: "failed"; reason: "read_failed" | "generation_failed" | "invalid_draft" };

export function createOrganizeNote({
  readNote,
  generateDraft,
}: {
  readNote: (ownerId: string, noteId: string) => Promise<StoredNote | undefined>;
  generateDraft: DraftGenerator;
}) {
  /** ownerId is verified server identity. The caller owns run lifetime and cancellation. */
  return async function organizeNote(
    ownerId: string,
    noteId: string,
    { signal }: { signal: AbortSignal },
  ): Promise<OrganizeNoteResult> {
    if (signal.aborted) return { status: "cancelled" };

    let snapshot: StoredNote | undefined;
    try {
      snapshot = await readNote(ownerId, noteId);
    } catch {
      return signal.aborted ? { status: "cancelled" } : { status: "failed", reason: "read_failed" };
    }
    if (signal.aborted) return { status: "cancelled" };
    if (!snapshot) return { status: "not_found" };

    const source = { noteId: snapshot.note.id, revision: snapshot.revision };
    let generated: unknown;
    try {
      generated = await generateDraft(
        { title: snapshot.note.title, content: snapshot.note.content },
        { signal },
      );
    } catch (error) {
      if (error instanceof GenerationCleanupError) {
        return { status: "failed", reason: "cleanup_failed", retryCleanup: error.retryCleanup };
      }
      return signal.aborted
        ? { status: "cancelled" }
        : { status: "failed", reason: "generation_failed" };
    }
    if (signal.aborted) return { status: "cancelled" };
    const draft = generatedDraftSchema.safeParse(generated);
    if (!draft.success) return { status: "failed", reason: "invalid_draft" };

    let current: StoredNote | undefined;
    try {
      current = await readNote(ownerId, noteId);
    } catch {
      return signal.aborted ? { status: "cancelled" } : { status: "failed", reason: "read_failed" };
    }
    if (signal.aborted) return { status: "cancelled" };
    if (!current) return { status: "not_found" };

    return {
      status: "draft",
      draft: draft.data,
      source: { ...source, stale: current.revision !== source.revision },
    };
  };
}
