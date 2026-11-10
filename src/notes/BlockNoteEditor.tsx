import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUUpLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowUUpLeft";
import { ArrowUUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUUpRight";
import { Button } from "@/components/ui/button";
import { canImportGeneratedMarkdown } from "./generated-markdown";
import { findMarkdownSourceBlock } from "./markdown-source-location";
import { noteSchema as schema } from "./editor-schema";
import { noteSyntaxHighlighting } from "./code-theme";
import { createCodePasteHandler } from "./code-detection";
import { AtlasEditorControls, atlasShadcnComponents } from "./editor-controls";
import { BlockNoteEditor as CoreEditor } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  blockNoteDocumentSchema,
  canonicalNoteContent,
  noteLinkSchema,
  type BlockNoteDocument,
  type NoteContent,
} from "../../shared/document";
import "@blocknote/shadcn/style.css";
import "./block-editor.css";

const links = {
  isValidLink(href: string) {
    return noteLinkSchema.safeParse(href).success;
  },
};

// Legacy Markdown conversion needs only the schema, never a view. One editor, created on
// first use and never mounted, serves every note instead of one full editor per mount.
const createMarkdownParser = () => CoreEditor.create({ schema, links });
let markdownParser: ReturnType<typeof createMarkdownParser> | undefined;
const getMarkdownParser = () => (markdownParser ??= createMarkdownParser());

type EditorMode = "loading" | "rich" | "source";
type EditorProps = {
  importGeneratedMarkdown?: boolean;
  initialContent: NoteContent;
  disabled: boolean;
  highlightedBlockId?: string;
  highlightedRange?: { startOffset: number; endOffset: number };
  onChange: (content: NoteContent) => void;
  onModeChange: (mode: EditorMode) => void;
  onValidityChange: (valid: boolean) => void;
};

export function BlockNoteEditor(props: EditorProps) {
  // Selection/reload remounts this component. Save responses and keystrokes do
  // not, preserving the undo history and edits made during an in-flight save.
  const [initial] = useState(props.initialContent);
  return typeof initial === "string" ? (
    <MarkdownNoteEditor {...props} initialContent={initial} source={initial} />
  ) : (
    <RichDocumentEditor {...props} initialContent={initial} document={initial} />
  );
}

function MarkdownNoteEditor(props: EditorProps & { source: string }) {
  const contentId = useId();
  const [source, setSource] = useState(props.source);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const [converted] = useState(() => {
    try {
      const parser = getMarkdownParser();
      const blocks = parser.tryParseMarkdownToBlocks(props.source);
      const roundtrip = parser.blocksToMarkdownLossy(blocks);
      // User-authored legacy notes retain exact spelling. Generated drafts may
      // normalize Markdown syntax only when their complete supported AST survives.
      const preservesContent = props.importGeneratedMarkdown
        ? canImportGeneratedMarkdown(props.source, roundtrip)
        : roundtrip.replace(/\n+$/, "") === props.source.replace(/\n+$/, "");
      if (!preservesContent) return null;
      return blockNoteDocumentSchema.parse({ format: "blocknote", schemaVersion: 1, blocks });
    } catch {
      return null;
    }
  });
  const { onModeChange } = props;
  useEffect(() => {
    if (!converted) onModeChange("source");
  }, [converted, onModeChange]);
  const startOffset = props.highlightedRange?.startOffset;
  const endOffset = props.highlightedRange?.endOffset;
  useEffect(() => {
    const textarea = sourceRef.current;
    if (
      !textarea ||
      startOffset === undefined ||
      endOffset === undefined ||
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      startOffset < 0 ||
      endOffset <= startOffset ||
      endOffset > textarea.value.length
    )
      return;
    textarea.setSelectionRange(startOffset, endOffset);
    textarea.focus({ preventScroll: true });
    // Measure the wrapped prefix with the textarea's own typography. Selection APIs
    // do not scroll a textarea, and counting newlines fails for wrapped mobile text.
    const mirror = document.createElement("textarea");
    const style = getComputedStyle(textarea);
    for (const property of [
      "font",
      "line-height",
      "letter-spacing",
      "padding",
      "border",
      "box-sizing",
      "white-space",
      "overflow-wrap",
      "tab-size",
    ]) {
      mirror.style.setProperty(property, style.getPropertyValue(property));
    }
    Object.assign(mirror.style, {
      position: "fixed",
      visibility: "hidden",
      width: `${textarea.clientWidth}px`,
      height: "0",
      minHeight: "0",
      fieldSizing: "fixed",
    });
    mirror.value = textarea.value.slice(0, startOffset);
    document.body.append(mirror);
    textarea.scrollTop = Math.max(0, mirror.scrollHeight - textarea.clientHeight / 3);
    mirror.remove();
    textarea.scrollIntoView({ block: "center" });
  }, [startOffset, endOffset]);
  const mappedBlockId = useMemo(() => {
    if (!converted || startOffset === undefined || endOffset === undefined) return undefined;
    return findMarkdownSourceBlock(
      props.source,
      converted.blocks,
      { startOffset, endOffset },
      (blocks) => getMarkdownParser().blocksToMarkdownLossy(blocks),
    );
  }, [converted, props.source, startOffset, endOffset]);
  if (converted)
    return (
      <>
        {props.highlightedRange && !mappedBlockId ? (
          <p role="note">
            This passage cannot be highlighted in the current view. Its retrieved excerpt is shown
            above.
          </p>
        ) : null}
        <RichDocumentEditor
          {...props}
          highlightedBlockId={mappedBlockId ?? props.highlightedBlockId}
          initialContent={props.importGeneratedMarkdown ? converted : props.initialContent}
          importedFromMarkdown={props.importGeneratedMarkdown}
          document={converted}
        />
      </>
    );
  const citedRangeAttr = props.highlightedRange
    ? `${props.highlightedRange.startOffset}-${props.highlightedRange.endOffset}`
    : undefined;
  return (
    <div className="space-y-2" data-cited-range={citedRangeAttr}>
      <Label htmlFor={contentId}>Markdown source</Label>
      <p className="text-sm text-muted-foreground">
        Source mode preserves this Markdown without conversion.
      </p>
      <Textarea
        ref={sourceRef}
        id={contentId}
        value={source}
        maxLength={100_000}
        rows={6}
        className="note-source max-h-[60vh]"
        data-cited-range={citedRangeAttr}
        readOnly={props.disabled}
        onChange={(event) => {
          setSource(event.target.value);
          props.onChange(event.target.value);
        }}
      />
    </div>
  );
}

function RichDocumentEditor({
  initialContent,
  document,
  disabled,
  highlightedBlockId,
  highlightedRange,
  onChange,
  onModeChange,
  onValidityChange,
  importedFromMarkdown = false,
}: EditorProps & { document: BlockNoteDocument; importedFromMarkdown?: boolean }) {
  const contentId = useId();
  const containerRef = useRef<HTMLElement | null>(null);
  // Initialize with the actual content: importing through replaceBlocks would
  // create an undo entry that could erase the note immediately after opening.
  const editor = useCreateBlockNote({
    schema,
    links,
    initialContent: document.blocks,
    extensions: [noteSyntaxHighlighting],
    pasteHandler: createCodePasteHandler(document.blocks),
    domAttributes: {
      editor: {
        id: contentId,
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Note content",
      },
    },
  });
  const lastDocument = useRef(JSON.stringify(editor.document));
  const initialDocument = useRef(canonicalNoteContent(document));
  useEffect(() => onModeChange("rich"), [onModeChange]);
  const publishedImport = useRef(false);
  useEffect(() => {
    if (importedFromMarkdown && !publishedImport.current) {
      publishedImport.current = true;
      onChange(document);
    }
  }, [document, importedFromMarkdown, onChange]);
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const clearMarks = () => {
      for (const previous of root.querySelectorAll("[data-cited-block='true']")) {
        previous.removeAttribute("data-cited-block");
        previous.removeAttribute("tabindex");
      }
    };
    clearMarks();
    if (!highlightedBlockId) return;
    const selector = `[data-node-type="blockContainer"][data-id="${CSS.escape(highlightedBlockId)}"]`;
    let scrolled = false;
    const applyMark = () => {
      const matched = root.querySelector<HTMLElement>(selector);
      if (!matched) return;
      if (matched.getAttribute("data-cited-block") !== "true") {
        matched.setAttribute("data-cited-block", "true");
      }
      if (!scrolled && typeof matched.scrollIntoView === "function") {
        scrolled = true;
        matched.tabIndex = -1;
        matched.focus({ preventScroll: true });
        matched.scrollIntoView({ block: "nearest" });
      }
    };
    applyMark();
    const observer = new MutationObserver(() => applyMark());
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearMarks();
    };
  }, [highlightedBlockId, document]);
  const citedRangeAttr = highlightedRange
    ? `${highlightedRange.startOffset}-${highlightedRange.endOffset}`
    : undefined;
  return (
    <section
      ref={containerRef}
      className="rich-note-editor"
      aria-label="Note editor"
      data-cited-block-id={highlightedBlockId}
      data-cited-range={citedRangeAttr}
    >
      <div className="editor-history" aria-label="Editing history">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo"
          title="Undo (Ctrl/Cmd+Z)"
          disabled={disabled}
          onClick={() => editor.undo()}
        >
          <ArrowUUpLeftIcon size={18} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Redo"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          disabled={disabled}
          onClick={() => editor.redo()}
        >
          <ArrowUUpRightIcon size={18} aria-hidden="true" />
        </Button>
      </div>
      <BlockNoteView
        editor={editor}
        shadCNComponents={atlasShadcnComponents}
        formattingToolbar={false}
        sideMenu={false}
        slashMenu={false}
        linkToolbar={false}
        emojiPicker={false}
        tableHandles={false}
        filePanel={false}
        theme="light"
        editable={!disabled}
        onChange={() => {
          const serialized = JSON.stringify(editor.document);
          if (serialized === lastDocument.current) return;
          lastDocument.current = serialized;
          const parsed = blockNoteDocumentSchema.safeParse({
            format: "blocknote",
            schemaVersion: 1,
            blocks: editor.document,
          });
          // Invalid/oversized edits remain visible. Do not submit the previous
          // valid value as though it were the current document.
          onValidityChange(parsed.success);
          if (parsed.success) {
            onChange(
              typeof initialContent === "string" &&
                canonicalNoteContent(parsed.data) === initialDocument.current
                ? initialContent
                : parsed.data,
            );
          }
        }}
      >
        <AtlasEditorControls />
      </BlockNoteView>
    </section>
  );
}

export function BlockNoteReader({ content }: { content: BlockNoteDocument }) {
  const editor = useCreateBlockNote(
    { schema, links, initialContent: content.blocks, extensions: [noteSyntaxHighlighting] },
    [content],
  );
  return (
    <section className="rich-note-editor" aria-label="Saved note content">
      <BlockNoteView editor={editor} theme="light" editable={false} />
    </section>
  );
}
