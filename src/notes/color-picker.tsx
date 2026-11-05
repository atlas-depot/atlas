import { blockHasType, editorHasBlockWithType } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useEditorState,
  useExtensionState,
  usePortalElement,
} from "@blocknote/react";
import type { ReactNode } from "react";

const colors = [
  "default",
  "gray",
  "brown",
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
] as const;

/** The side-menu snapshot is frozen while open; read color props from the live document. */
export function LiveBlockColorsItem({ children }: { children: ReactNode }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const portalElement = usePortalElement();
  const dict = useDictionary();
  const id = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block.id });
  const block = useEditorState({
    editor,
    on: "change",
    selector: () => (id ? editor.getBlock(id) : undefined),
  });
  if (!block) return null;
  const text =
    blockHasType(block, editor, block.type, { textColor: "string" }) &&
    editorHasBlockWithType(editor, block.type, { textColor: "string" });
  const background =
    blockHasType(block, editor, block.type, { backgroundColor: "string" }) &&
    editorHasBlockWithType(editor, block.type, { backgroundColor: "string" });
  if (!text && !background) return null;
  return (
    <Components.Generic.Menu.Root position="right" sub portalElement={portalElement}>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          {children}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown bn-color-picker-dropdown">
        {text && (
          <>
            <Components.Generic.Menu.Label>
              {dict.color_picker.text_title}
            </Components.Generic.Menu.Label>
            {colors.map((color) => (
              <Components.Generic.Menu.Item
                key={`text-${color}`}
                data-test={`text-color-${color}`}
                checked={block.props.textColor === color}
                onClick={() =>
                  editor.updateBlock(block.id, { type: block.type, props: { textColor: color } })
                }
                icon={
                  <span
                    className="bn-color-icon"
                    data-text-color={color}
                    data-background-color="default"
                    aria-hidden="true"
                  >
                    A
                  </span>
                }
              >
                {dict.color_picker.colors[color]}
              </Components.Generic.Menu.Item>
            ))}
          </>
        )}
        {background && (
          <>
            <Components.Generic.Menu.Label>
              {dict.color_picker.background_title}
            </Components.Generic.Menu.Label>
            {colors.map((color) => (
              <Components.Generic.Menu.Item
                key={`background-${color}`}
                data-test={`background-color-${color}`}
                checked={block.props.backgroundColor === color}
                onClick={() => editor.updateBlock(block.id, { props: { backgroundColor: color } })}
                icon={
                  <span
                    className="bn-color-icon"
                    data-text-color="default"
                    data-background-color={color}
                    aria-hidden="true"
                  >
                    A
                  </span>
                }
              >
                {dict.color_picker.colors[color]}
              </Components.Generic.Menu.Item>
            ))}
          </>
        )}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}
