import { createReactBlockSpec } from "@blocknote/react";
import { codeLanguageChoices, noteCodeBlock as baseCodeBlock } from "./code-theme";
import { markCodeLanguageExplicit } from "./code-detection";
import { CodeLanguagePicker } from "./CodeLanguagePicker";
import "./code-language.css";

const highlightLanguages = new Map(
  codeLanguageChoices.flatMap(({ id, aliases }) => [id, ...aliases].map((label) => [label, id])),
);

// Only the editor view changes. Parsing, export and keyboard behavior stay native.
export const noteCodeBlock = createReactBlockSpec(
  baseCodeBlock.config,
  {
    meta: {
      ...baseCodeBlock.implementation.meta,
      // Preserve unknown stored labels without sending them to Shiki. Its
      // synchronous unknown-language error can stop highlighting later blocks.
      highlight: (block) => highlightLanguages.get(block.props.language),
    },
    parse: baseCodeBlock.implementation.parse,
    parseContent: baseCodeBlock.implementation.parseContent,
    render: ({ block, editor, contentRef }) => (
      <div className="note-code-block">
        <CodeLanguagePicker
          value={block.props.language}
          disabled={!editor.isEditable}
          onChange={(language) => {
            markCodeLanguageExplicit(editor, block.id);
            editor.updateBlock(block.id, { props: { language } });
          }}
        />
        <pre>
          <code ref={contentRef} />
        </pre>
      </div>
    ),
  },
  baseCodeBlock.extensions,
)();

noteCodeBlock.implementation.toExternalHTML = baseCodeBlock.implementation.toExternalHTML;
