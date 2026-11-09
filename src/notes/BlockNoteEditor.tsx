import { useEffect, useId, useRef, useState } from "react";
import { ArrowUUpLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowUUpLeft";
import { ArrowUUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowUUpRight";
import { Button } from "@/components/ui/button";
import { canImportGeneratedMarkdown } from "./generated-markdown";
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
  if (converted)
    return (
      <RichDocumentEditor
        {...props}
        initialContent={props.importGeneratedMarkdown ? converted : props.initialContent}
        importedFromMarkdown={props.importGeneratedMarkdown}
        document={converted}
      />
    );
  return (
    <div className="space-y-2">
      <Label htmlFor={contentId}>Markdown source</Label>
      <p className="text-sm text-muted-foreground">
        Source mode preserves this Markdown without conversion.
      </p>
      <Textarea
        id={contentId}
        value={source}
        maxLength={100_000}
        rows={6}
        className="note-source"
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
  onChange,
  onModeChange,
  onValidityChange,
  importedFromMarkdown = false,
}: EditorProps & { document: BlockNoteDocument; importedFromMarkdown?: boolean }) {
  const contentId = useId();
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
  return (
    <section className="rich-note-editor" aria-label="Note editor">
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
