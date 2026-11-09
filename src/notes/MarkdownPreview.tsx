import { lazy, Suspense } from "react";

// react-markdown and remark-gfm load in their own chunk, only once a preview is shown.
const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <Suspense fallback={null}>
      <MarkdownRenderer content={content} />
    </Suspense>
  );
}
