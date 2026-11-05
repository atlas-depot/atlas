import { lazy, Suspense } from "react";
import type { NoteContent } from "../../shared/document";
import { MarkdownPreview } from "./MarkdownPreview";

const BlockNoteReader = lazy(() =>
  import("./BlockNoteEditor").then((module) => ({ default: module.BlockNoteReader })),
);

export function NoteContentView({ content }: { content: NoteContent }) {
  return typeof content === "string" ? (
    <MarkdownPreview content={content} />
  ) : (
    <Suspense fallback={<p>Opening saved content...</p>}>
      <BlockNoteReader content={content} />
    </Suspense>
  );
}
