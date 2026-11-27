import { lazy, Suspense } from "react";

// react-markdown and remark-gfm load in their own chunk, only once a preview is shown.
const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

export function MarkdownPreview({
  content,
  onOpenNoteLink,
}: {
  content: string;
  onOpenNoteLink?: (noteId: string) => void;
}) {
  return (
    <Suspense fallback={null}>
      <MarkdownRenderer content={content} onOpenNoteLink={onOpenNoteLink} />
    </Suspense>
  );
}
