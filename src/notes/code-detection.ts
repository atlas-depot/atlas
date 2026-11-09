import type { HLJSApi } from "highlight.js";
import { blockToNode } from "@blocknote/core";
import { closeHistory } from "@tiptap/pm/history";
import { bundledLanguagesInfo } from "shiki/langs";
import { noteTextSchema } from "../../shared/document.ts";
import type { NoteEditorInstance } from "./editor-schema";

const explicitChoices = new WeakMap<object, Set<string>>();
const maximumDetectionLength = 20_000;
const codeLanguageSchema = noteTextSchema.max(128);

// highlight.js is only needed on paste, so it loads in its own chunk once an editor exists.
let highlighter: HLJSApi | undefined;
let loading: Promise<void> | undefined;

/** Starts loading the detector once; a failed load is retried on the next call. */
export function loadCodeDetection(): Promise<void> {
  loading ??= import("highlight.js/lib/common").then(
    (module) => {
      highlighter = module.default;
    },
    () => {
      loading = undefined;
    },
  );
  return loading;
}

/** Choosing Plain text is just as deliberate as choosing Python. */
export function markCodeLanguageExplicit(editor: object, blockId: string): void {
  let choices = explicitChoices.get(editor);
  if (!choices) explicitChoices.set(editor, (choices = new Set()));
  choices.add(blockId);
}

/** A local heuristic, not a claim that every displayed language is detectable. */
export function detectCodeLanguage(source: string): string | undefined {
  // Until the detector has loaded, pastes keep their plain text behavior.
  if (!highlighter) return;
  if (source.length > maximumDetectionLength || source.trim().length < 12) return;
  const result = highlighter.highlightAuto(source);
  // Short or weak matches are safer as plain text. Relevance is a grammar score,
  // not a probability. The user can always correct a plausible but wrong guess.
  if (!result.language || result.relevance < 3) return;
  const language = bundledLanguagesInfo.find(
    ({ id, aliases }) => id === result.language || aliases?.includes(result.language!),
  );
  return language?.id;
}

type InitialBlock = { id?: string; type?: string; children?: readonly InitialBlock[] };
type PasteContext = {
  editor: NoteEditorInstance;
  event: ClipboardEvent;
  defaultPasteHandler: (options?: { prioritizeMarkdownOverHTML?: boolean }) => boolean | undefined;
};

function codeClipboardLanguage(clipboard: DataTransfer): string | undefined {
  try {
    const metadata: unknown = JSON.parse(clipboard.getData("vscode-editor-data"));
    if (typeof metadata === "object" && metadata !== null && "mode" in metadata) {
      const language = codeLanguageSchema.safeParse(metadata.mode);
      if (language.success) return language.data;
    }
  } catch {
    /* Malformed metadata still has literal text that can be pasted. */
  }
  return undefined;
}

/** Add info strings only to complete, unlabelled top-level Markdown fences. */
export function inferUnlabelledCodeFences(markdown: string): string | undefined {
  if (markdown.length > maximumDetectionLength) return;
  let open: { marker: string; body: number; label: number; unlabelled: boolean } | undefined;
  let offset = 0;
  const edits: { offset: number; language: string }[] = [];
  for (const line of markdown.split("\n")) {
    const fence = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(line);
    if (fence) {
      const [, indent, marker, info] = fence;
      if (open) {
        if (
          marker[0] === open.marker[0] &&
          marker.length >= open.marker.length &&
          info.trim() === ""
        ) {
          const language = open.unlabelled
            ? detectCodeLanguage(markdown.slice(open.body, offset))
            : undefined;
          if (language) edits.push({ offset: open.label, language });
          open = undefined;
        }
      } else if (marker[0] !== "`" || !info.includes("`")) {
        open = {
          marker,
          body: offset + line.length + 1,
          label: offset + indent.length + marker.length,
          unlabelled: info.trim() === "",
        };
      }
    }
    offset += line.length + 1;
  }
  if (edits.length === 0) return;
  // Insert backwards so offsets and every source byte remain unchanged.
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.offset) + edit.language + markdown.slice(edit.offset);
  return markdown;
}

/** Paste and language metadata share one native undo transaction. */
export function createCodePasteHandler(initialDocument: readonly InitialBlock[]) {
  void loadCodeDetection();
  const savedCodeIds = new Set<string>();
  const visit = (blocks: readonly InitialBlock[]) => {
    for (const block of blocks) {
      if (block.type === "codeBlock" && block.id) savedCodeIds.add(block.id);
      if (block.children) visit(block.children);
    }
  };
  visit(initialDocument);

  return ({ editor, event, defaultPasteHandler }: PasteContext): boolean | undefined => {
    const clipboard = event.clipboardData;
    if (!clipboard) return defaultPasteHandler();
    const source = clipboard.getData("text/plain");
    const fromVSCode = clipboard.types.includes("vscode-editor-data");
    const declaredLanguage = fromVSCode ? codeClipboardLanguage(clipboard) : undefined;
    const block = editor.getTextCursorPosition().block;
    const withinCode = editor.transact(
      (tr) =>
        tr.selection.$from.sameParent(tr.selection.$to) && tr.selection.$from.parent.type.spec.code,
    );
    if (block.type === "codeBlock" && withinCode) {
      const empty = block.content.every((part) => part.type === "text" && part.text === "");
      const canGuess =
        empty &&
        block.props.language === "text" &&
        !savedCodeIds.has(block.id) &&
        !explicitChoices.get(editor)?.has(block.id);
      const language = canGuess
        ? fromVSCode
          ? declaredLanguage
          : detectCodeLanguage(source)
        : undefined;
      if (!language) return defaultPasteHandler();
      return editor.transact((tr) => {
        // pasteText dispatches through the view. Insert through the active
        // transaction instead so text and metadata cannot split into two edits.
        closeHistory(tr).insertText(source).setMeta("paste", true).setMeta("uiEvent", "paste");
        editor.updateBlock(block.id, { props: { language } });
        return true;
      });
    }
    if (fromVSCode) {
      return editor.transact((tr) => {
        closeHistory(tr);
        if (declaredLanguage) {
          // Structured nodes preserve literal tags, entities and unknown language
          // names. The upstream VS Code HTML paste interpolates them unescaped.
          const node = blockToNode(
            { type: "codeBlock", props: { language: declaredLanguage }, content: source },
            tr.doc.type.schema,
          );
          tr.replaceSelectionWith(node, false);
        } else tr.insertText(source);
        tr.setMeta("paste", true).setMeta("uiEvent", "paste");
        return true;
      });
    }
    // Respect structured copies, file drops and VS Code's explicit language.
    if (clipboard.types.some((type) => ["blocknote/html", "Files"].includes(type)))
      return defaultPasteHandler();
    // Rich copies carry a plain-text fallback too. Do not infer from that
    // fallback and discard the formatting or links in the actual HTML payload.
    if (clipboard.types.includes("text/html"))
      return defaultPasteHandler({ prioritizeMarkdownOverHTML: false });
    const markdown = clipboard.getData("text/markdown") || source;
    const inferred = inferUnlabelledCodeFences(markdown);
    if (!inferred) return defaultPasteHandler();
    editor.transact((tr) => closeHistory(tr));
    editor.pasteMarkdown(inferred);
    return true;
  };
}
