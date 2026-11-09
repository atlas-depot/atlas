import { noteIdSchema } from "../shared/notes.ts";
import {
  notePassageVersionSchema,
  type NotePassageProjection,
  type NotePassageProjectionInput,
} from "../shared/passages.ts";
import { malformed } from "./passages/common.ts";
import { projectMarkdown } from "./passages/markdown.ts";
import { projectBlockDocument } from "./passages/blocknote.ts";

export function projectNotePassages(input: NotePassageProjectionInput): NotePassageProjection {
  const noteId = noteIdSchema.safeParse(input.noteId);
  const version = notePassageVersionSchema.safeParse(input.version);
  if (!noteId.success || !version.success) return malformed("invalid_source");
  const sourceBase = { noteId: noteId.data, version: version.data };
  if (typeof input.content === "string") return projectMarkdown(input.content, sourceBase);
  if (typeof input.content === "object" && input.content !== null) {
    return projectBlockDocument(input.content, sourceBase);
  }
  return malformed("content_schema");
}
