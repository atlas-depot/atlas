import { useEffect, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
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

// The document contract intentionally has no media/upload blocks. In particular,
// opening a note must not fetch an arbitrary image supplied by its contents.
const {
  paragraph,
  heading,
  bulletListItem,
  numberedListItem,
  checkListItem,
  quote,
  codeBlock,
  divider,
  table,
} = defaultBlockSpecs;
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading,
    bulletListItem,
    numberedListItem,
    checkListItem,
    quote,
    codeBlock,
    divider,
    table,
  },
});
const links = {
  isValidLink(href: string) {
    return noteLinkSchema.safeParse(href).success;
  },
};

type EditorMode = "loading" | "rich" | "source";
type EditorProps = {
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
    <LegacyNoteEditor {...props} initialContent={initial} source={initial} />
  ) : (
    <RichDocumentEditor {...props} initialContent={initial} document={initial} />
  );
}

function LegacyNoteEditor(props: EditorProps & { source: string }) {
  const parser = useCreateBlockNote({ schema, links });
  const [source, setSource] = useState(props.source);
  const [converted] = useState(() => {
    try {
      const blocks = parser.tryParseMarkdownToBlocks(props.source);
      const roundtrip = parser.blocksToMarkdownLossy(blocks);
      // Conservative on purpose: even harmless normalizing changes fall back
      // to source editing, rather than silently discarding Markdown features.
      if (roundtrip.replace(/\n+$/, "") !== props.source.replace(/\n+$/, "")) return null;
      return blockNoteDocumentSchema.parse({ format: "blocknote", schemaVersion: 1, blocks });
    } catch {
      return null;
    }
  });
  const { onModeChange } = props;
  useEffect(() => {
    if (!converted) onModeChange("source");
  }, [converted, onModeChange]);
  if (converted) return <RichDocumentEditor {...props} document={converted} />;
  return (
    <div className="space-y-2">
      <Label htmlFor="note-content">Markdown source</Label>
      <p className="text-sm text-muted-foreground">
        Source mode preserves this Markdown without conversion.
      </p>
      <Textarea
        id="note-content"
        value={source}
        maxLength={100_000}
        rows={6}
        className="note-source"
        disabled={props.disabled}
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
}: EditorProps & { document: BlockNoteDocument }) {
  // Initialize with the actual content: importing through replaceBlocks would
  // create an undo entry that could erase the note immediately after opening.
  const editor = useCreateBlockNote({
    schema,
    links,
    initialContent: document.blocks,
    domAttributes: {
      editor: {
        id: "note-content",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Note content",
      },
    },
  });
  const lastDocument = useRef(JSON.stringify(editor.document));
  const initialDocument = useRef(canonicalNoteContent(document));
  useEffect(() => onModeChange("rich"), [onModeChange]);
  return (
    <section className="rich-note-editor" aria-label="Note editor">
      <BlockNoteView
        editor={editor}
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
      />
    </section>
  );
}

export function BlockNoteReader({ content }: { content: BlockNoteDocument }) {
  const editor = useCreateBlockNote({ schema, links, initialContent: content.blocks }, [content]);
  return (
    <section className="rich-note-editor" aria-label="Saved note content">
      <BlockNoteView editor={editor} theme="light" editable={false} />
    </section>
  );
}
