import { noteTextSchema } from "../shared/document.ts";
import {
  notePassageSourceSchema,
  type NotePassage,
  type NotePassageSource,
} from "../shared/passages.ts";

// Match the existing note text limits: UTF-16 code units, without truncation or normalization.
const excerptSchema = noteTextSchema.refine((value) => value.length > 0 && value.length <= 1_000, {
  error: "An excerpt must contain between 1 and 1,000 UTF-16 code units.",
});

type CitationResolution =
  | { status: "resolved"; citation: { source: NotePassageSource; excerpt: string } }
  | { status: "rejected"; reason: "invalid_citation" | "unknown_source" | "excerpt_mismatch" };

function sameSource(left: NotePassageSource, right: NotePassageSource): boolean {
  if (
    left.noteId !== right.noteId ||
    left.version !== right.version ||
    left.part !== right.part ||
    left.headingPath.length !== right.headingPath.length ||
    !left.headingPath.every((heading, index) => heading === right.headingPath[index])
  ) {
    return false;
  }
  if (left.kind === "block" && right.kind === "block") return left.blockId === right.blockId;
  return (
    left.kind === "markdown" &&
    right.kind === "markdown" &&
    left.startOffset === right.startOffset &&
    left.endOffset === right.endOffset
  );
}

/**
 * Resolve one untrusted citation against the exact passages supplied to this generation.
 * The caller must authorize evidence before generation and recheck access/existence before
 * publication. Resolution proves quote provenance, not claim support or instruction safety.
 * This is an internal check, not the conversation API or model response envelope.
 */
export function resolveNoteCitation(
  reference: unknown,
  excerpt: unknown,
  evidence: readonly NotePassage[],
): CitationResolution {
  const source = notePassageSourceSchema.safeParse(reference);
  const quote = excerptSchema.safeParse(excerpt);
  if (!source.success || !quote.success) {
    return { status: "rejected", reason: "invalid_citation" };
  }

  const passage = evidence.find((candidate) => sameSource(candidate.source, source.data));
  if (!passage) return { status: "rejected", reason: "unknown_source" };
  // Markdown offsets refer to the source node, not the syntax-free projected passage text.
  if (!passage.text.includes(quote.data)) {
    return { status: "rejected", reason: "excerpt_mismatch" };
  }
  return {
    status: "resolved",
    citation: { source: structuredClone(passage.source), excerpt: quote.data },
  };
}
