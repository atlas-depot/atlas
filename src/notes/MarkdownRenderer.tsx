import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseInternalNoteHref } from "./note-metadata";

/** Keep the renderer's safe URL defaults. Never enable raw HTML parsing here. */
export default function MarkdownRenderer({
  content,
  onOpenNoteLink,
}: {
  content: string;
  onOpenNoteLink?: (noteId: string) => void;
}) {
  const origin = typeof window === "undefined" ? undefined : window.location.origin;
  return (
    <section className="markdown-preview" aria-label="Markdown preview">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        components={{
          a: ({ href, children, node: _node, ...rest }) => {
            const linkedNoteId =
              href && onOpenNoteLink ? parseInternalNoteHref(href, origin) : null;
            if (linkedNoteId && onOpenNoteLink) {
              return (
                <a
                  {...rest}
                  href={href}
                  onClick={(event) => {
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey ||
                      event.button !== 0
                    ) {
                      return;
                    }
                    event.preventDefault();
                    onOpenNoteLink(linkedNoteId);
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a {...rest} href={href}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </Markdown>
    </section>
  );
}
