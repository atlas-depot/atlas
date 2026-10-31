import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Keep the renderer's safe URL defaults. Never enable raw HTML parsing here. */
export function MarkdownPreview({ content }: { content: string }) {
  return (
    <section className="markdown-preview" aria-label="Markdown preview">
      <Markdown skipHtml remarkPlugins={[remarkGfm]} disallowedElements={["img"]}>
        {content}
      </Markdown>
    </section>
  );
}
