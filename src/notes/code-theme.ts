import { createCodeBlockSpec } from "@blocknote/core";
import { SyntaxHighlightingExtension } from "@blocknote/core/extensions";
import { bundledLanguagesInfo, bundledLanguages } from "shiki/langs";

/** Catalog metadata is available immediately; grammar modules remain lazy imports. */
export const codeLanguageChoices = [
  { id: "text", name: "Plain text", aliases: ["txt", "plaintext"] },
  ...bundledLanguagesInfo.map(({ id, name, aliases }) => ({
    id,
    name,
    aliases: aliases ? [...aliases] : [],
  })),
];

// Keep plain text explicit: an existing unlabelled snippet must not gain a language.
export const noteCodeBlock = createCodeBlockSpec({
  defaultLanguage: "text",
  indentLineWithTab: true,
  supportedLanguages: Object.fromEntries(
    codeLanguageChoices.map(({ id, name, aliases }) => [id, { name, aliases }]),
  ),
});

export async function createNoteCodeHighlighter() {
  const [{ createBundledHighlighter }, { createJavaScriptRegexEngine }] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
  ]);
  const createHighlighter = createBundledHighlighter({
    langs: bundledLanguages,
    themes: { "catppuccin-mocha": () => import("shiki/themes/catppuccin-mocha.mjs") },
    engine: () => createJavaScriptRegexEngine(),
  });
  // BlockNote calls loadLanguage for the block's declared language on first use.
  return createHighlighter({ themes: ["catppuccin-mocha"], langs: [] });
}

export const noteSyntaxHighlighting = SyntaxHighlightingExtension({
  createHighlighter: createNoteCodeHighlighter,
});
