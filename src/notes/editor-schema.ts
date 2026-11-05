import { BlockNoteSchema, defaultBlockSpecs, type BlockNoteEditor } from "@blocknote/core";
import { noteCodeBlock } from "./CodeBlock";

// No media/upload blocks: opening a note must not fetch user-supplied remote content.
const {
  paragraph,
  heading,
  bulletListItem,
  numberedListItem,
  checkListItem,
  quote,
  divider,
  table,
} = defaultBlockSpecs;
export const noteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading,
    bulletListItem,
    numberedListItem,
    checkListItem,
    quote,
    divider,
    table,
    codeBlock: noteCodeBlock,
  },
});
export type NoteEditorInstance = BlockNoteEditor<typeof noteSchema.blockSchema>;
