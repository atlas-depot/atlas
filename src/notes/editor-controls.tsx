import { forwardRef, useMemo, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { getDefaultBlockTypeItems } from "@blocknote/core";
import {
  SideMenuExtension,
  SuggestionMenu,
  filterSuggestionItems,
  getDefaultSlashMenuItems,
} from "@blocknote/core/extensions";
import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  ComponentsContext,
  CreateLinkButton,
  DeleteLinkButton,
  EditLinkButton,
  FormattingToolbar,
  FormattingToolbarController,
  LinkToolbar,
  LinkToolbarController,
  NestBlockButton,
  OpenLinkButton,
  RemoveBlockItem,
  SideMenuController,
  SuggestionMenuController,
  TableHandlesController,
  TableHandle,
  TableCellButton,
  ExtendButton,
  TableCellMergeButton,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  type TableHandleProps,
  type TableCellButtonProps,
  type ExtendButtonProps,
  TextAlignButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtension,
  useExtensionState,
  usePortalElement,
  type ComponentProps,
  type LinkToolbarProps,
} from "@blocknote/react";
import {
  ShadCNDefaultComponents,
  ShadCNComponentsContext,
  useShadCNComponentsContext,
  components as shadcnComponents,
} from "@blocknote/shadcn";
import {
  ArrowSquareOut,
  ArrowsInSimple,
  CaretDown,
  CaretRight,
  Check,
  CheckSquare,
  Code,
  CodeBlock,
  DotsSixVertical,
  SpinnerGap,
  Table,
  Link,
  LinkBreak,
  ListBullets,
  ListNumbers,
  Palette,
  PencilSimple,
  Plus,
  Quotes,
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  TextB,
  TextH,
  TextHOne,
  TextHTwo,
  TextHThree,
  TextHFour,
  TextHFive,
  TextHSix,
  TextIndent,
  TextItalic,
  TextOutdent,
  TextStrikethrough,
  TextT,
  TextUnderline,
  Trash,
  type Icon,
} from "@phosphor-icons/react";
import { LiveBlockColorsItem } from "./color-picker";

// Icons are supplied at each semantic control. The stock control still owns
// selection, shortcuts and focus; we never inspect or rewrite its React nodes.
function ControlIcon({
  icon: Icon,
  family = "FormattingToolbar",
  children,
}: {
  icon: Icon;
  family?: "FormattingToolbar" | "LinkToolbar";
  children: ReactNode;
}) {
  const base = useComponentsContext()!;
  const components = useMemo(() => {
    const Button = base[family].Button as React.ComponentType<
      ComponentProps["FormattingToolbar"]["Button"] & React.RefAttributes<HTMLButtonElement>
    >;
    const IconButton = forwardRef<HTMLButtonElement, ComponentProps["FormattingToolbar"]["Button"]>(
      ({ children: replacedIcon, ...props }, ref) => {
        void replacedIcon;
        return (
          <Button
            {...props}
            ref={ref}
            label={props.label ?? props.mainTooltip ?? "Format"}
            icon={<Icon size={18} aria-hidden="true" />}
          />
        );
      },
    );
    return { ...base, [family]: { ...base[family], Button: IconButton } };
  }, [base, family, Icon]);
  return <ComponentsContext.Provider value={components}>{children}</ComponentsContext.Provider>;
}

const blockIcons: Record<string, Icon> = {
  paragraph: TextT,
  heading: TextHOne,
  heading_2: TextHTwo,
  heading_3: TextHThree,
  heading_4: TextHFour,
  heading_5: TextHFive,
  heading_6: TextHSix,
  toggle_heading: TextHOne,
  toggle_heading_2: TextHTwo,
  toggle_heading_3: TextHThree,
  quote: Quotes,
  bullet_list: ListBullets,
  numbered_list: ListNumbers,
  check_list: CheckSquare,
  toggle_list: ListBullets,
  code_block: CodeBlock,
  table: Table,
};

// Keep the stock link form, replacing its URL/title adornments explicitly.
function LinkFields({ children }: { children: ReactNode }) {
  const base = useComponentsContext()!;
  const components = useMemo(() => {
    const Input = base.Generic.Form.TextInput;
    function TextInput(props: ComponentProps["Generic"]["Form"]["TextInput"]) {
      const Icon = props.name === "url" ? Link : TextT;
      return <Input {...props} icon={<Icon size={18} aria-hidden="true" />} />;
    }
    return { ...base, Generic: { ...base.Generic, Form: { ...base.Generic.Form, TextInput } } };
  }, [base]);
  return <ComponentsContext.Provider value={components}>{children}</ComponentsContext.Provider>;
}

// Reuse the menu adapter instead of the default Select, whose internal arrows
// are tied to another icon set. Menu's mobile focus policy remains intact.
function BlockTypeMenu(props: ComponentProps["FormattingToolbar"]["Select"]) {
  const Components = useComponentsContext()!;
  const selected = props.items.find((item) => item.isSelected);
  if (!selected) return null;
  return (
    <Components.Generic.Menu.Root
      portalElement={props.portalElement}
      preventFocusOnOpen={props.preventFocusOnOpen}
    >
      <Components.Generic.Menu.Trigger>
        <Components.FormattingToolbar.Button
          label={`Block type: ${selected.text}`}
          mainTooltip="Block type"
          icon={selected.icon}
          isDisabled={props.isDisabled}
        />
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown className="bn-menu-dropdown">
        {props.items.map((item) => (
          <Components.Generic.Menu.Item
            key={item.text}
            icon={item.icon}
            onClick={item.onClick}
            disabled={item.isDisabled}
          >
            {item.text}
          </Components.Generic.Menu.Item>
        ))}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

export function AtlasFormattingToolbar() {
  const editor = useBlockNoteEditor();
  const base = useComponentsContext()!;
  const components = useMemo(
    () => ({ ...base, FormattingToolbar: { ...base.FormattingToolbar, Select: BlockTypeMenu } }),
    [base],
  );
  const items = getDefaultBlockTypeItems(editor).map(({ key, type, props }) => ({
    name: editor.dictionary.slash_menu[key].title,
    type,
    props,
    icon: blockIcons[key] ?? TextH,
  }));
  return (
    <ComponentsContext.Provider value={components}>
      <LinkFields>
        <FormattingToolbar>
          <BlockTypeSelect items={items} />
          <ControlIcon icon={ArrowsInSimple}>
            <TableCellMergeButton />
          </ControlIcon>
          <ControlIcon icon={TextB}>
            <BasicTextStyleButton basicTextStyle="bold" />
          </ControlIcon>
          <ControlIcon icon={TextItalic}>
            <BasicTextStyleButton basicTextStyle="italic" />
          </ControlIcon>
          <ControlIcon icon={TextUnderline}>
            <BasicTextStyleButton basicTextStyle="underline" />
          </ControlIcon>
          <ControlIcon icon={TextStrikethrough}>
            <BasicTextStyleButton basicTextStyle="strike" />
          </ControlIcon>
          <ControlIcon icon={Code}>
            <BasicTextStyleButton basicTextStyle="code" />
          </ControlIcon>
          <ControlIcon icon={TextAlignLeft}>
            <TextAlignButton textAlignment="left" />
          </ControlIcon>
          <ControlIcon icon={TextAlignCenter}>
            <TextAlignButton textAlignment="center" />
          </ControlIcon>
          <ControlIcon icon={TextAlignRight}>
            <TextAlignButton textAlignment="right" />
          </ControlIcon>
          <ControlIcon icon={Palette}>
            <ColorStyleButton />
          </ControlIcon>
          <ControlIcon icon={TextIndent}>
            <NestBlockButton />
          </ControlIcon>
          <ControlIcon icon={TextOutdent}>
            <UnnestBlockButton />
          </ControlIcon>
          <ControlIcon icon={Link}>
            <CreateLinkButton />
          </ControlIcon>
        </FormattingToolbar>
      </LinkFields>
    </ComponentsContext.Provider>
  );
}

export function AtlasLinkToolbar(props: LinkToolbarProps) {
  return (
    <LinkFields>
      <LinkToolbar {...props}>
        <ControlIcon family="LinkToolbar" icon={PencilSimple}>
          <EditLinkButton {...props} />
        </ControlIcon>
        <ControlIcon family="LinkToolbar" icon={ArrowSquareOut}>
          <OpenLinkButton url={props.url} />
        </ControlIcon>
        <ControlIcon family="LinkToolbar" icon={LinkBreak}>
          <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
        </ControlIcon>
      </LinkToolbar>
    </LinkFields>
  );
}

export function AtlasSideMenu() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;
  const dict = useDictionary();
  const portal = usePortalElement();
  const sideMenu = useExtension(SideMenuExtension);
  const suggestions = useExtension(SuggestionMenu);
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (!block) return null;
  const add = () => {
    const empty = Array.isArray(block.content) && block.content.length === 0;
    const target = empty ? block : editor.insertBlocks([{ type: "paragraph" }], block, "after")[0];
    editor.setTextCursorPosition(target);
    suggestions.openSuggestionMenu("/");
  };
  return (
    <Components.SideMenu.Root className="bn-side-menu" data-block-type={block.type}>
      <Components.SideMenu.Button
        className="bn-button"
        label={dict.side_menu.add_block_label}
        onClick={add}
        icon={<Plus size={14} aria-hidden="true" data-test="dragHandleAdd" />}
      />
      <Components.Generic.Menu.Root
        position="left"
        portalElement={portal}
        onOpenChange={(open) => (open ? sideMenu.freezeMenu() : sideMenu.unfreezeMenu())}
      >
        <Components.Generic.Menu.Trigger>
          <Components.SideMenu.Button
            className="bn-button"
            label={dict.side_menu.drag_handle_label}
            draggable
            onDragStart={(event) => sideMenu.blockDragStart(event, block)}
            onDragEnd={sideMenu.blockDragEnd}
            icon={<DotsSixVertical size={14} aria-hidden="true" data-test="dragHandle" />}
          />
        </Components.Generic.Menu.Trigger>
        <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu">
          <LiveBlockColorsItem>
            <Palette size={16} aria-hidden="true" />
            {dict.drag_handle.colors_menuitem}
          </LiveBlockColorsItem>
          <RemoveBlockItem>
            <Trash size={16} aria-hidden="true" />
            {dict.drag_handle.delete_menuitem}
          </RemoveBlockItem>
          <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
          <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
        </Components.Generic.Menu.Dropdown>
      </Components.Generic.Menu.Root>
    </Components.SideMenu.Root>
  );
}

// Keep upstream item keyboard navigation/scrolling, but render shortcuts as keys.
function ShortcutBadge(props: React.ComponentProps<typeof ShadCNDefaultComponents.Badge.Badge>) {
  return (
    <ShadCNDefaultComponents.Badge.Badge
      {...props}
      render={<kbd />}
      className={`atlas-kbd ${props.className ?? ""}`}
    />
  );
}
function AtlasSuggestionItem(props: ComponentProps["SuggestionMenu"]["Item"]) {
  const skin = useShadCNComponentsContext()!;
  const components = useMemo(() => ({ ...skin, Badge: { Badge: ShortcutBadge } }), [skin]);
  return (
    <ShadCNComponentsContext.Provider value={components}>
      <shadcnComponents.SuggestionMenu.Item {...props} />
    </ShadCNComponentsContext.Provider>
  );
}
function AtlasSuggestionLoader({ className }: ComponentProps["SuggestionMenu"]["Loader"]) {
  return <SpinnerGap size={18} className={className} aria-label="Loading suggestions" />;
}
function AtlasTableHandle(props: TableHandleProps) {
  return (
    <TableHandle {...props}>
      <DotsSixVertical size={16} data-test="tableHandle" aria-hidden="true" />
    </TableHandle>
  );
}
function AtlasTableCellHandle(props: TableCellButtonProps) {
  return (
    <TableCellButton {...props}>
      <CaretDown size={14} data-test="tableCellHandle" aria-hidden="true" />
    </TableCellButton>
  );
}
function AtlasExtendButton(props: ExtendButtonProps) {
  return (
    <ExtendButton {...props}>
      <Plus size={16} data-test="extendButton" aria-hidden="true" />
    </ExtendButton>
  );
}

export function AtlasEditorControls() {
  const editor = useBlockNoteEditor();
  const base = useComponentsContext()!;
  const components = useMemo(
    () => ({
      ...base,
      SuggestionMenu: {
        ...base.SuggestionMenu,
        Item: AtlasSuggestionItem,
        Loader: AtlasSuggestionLoader,
      },
    }),
    [base],
  );
  return (
    <ComponentsContext.Provider value={components}>
      <FormattingToolbarController formattingToolbar={AtlasFormattingToolbar} />
      <SideMenuController sideMenu={AtlasSideMenu} />
      <LinkToolbarController linkToolbar={AtlasLinkToolbar} />
      {"table" in editor.schema.blockSchema && (
        <TableHandlesController
          tableHandle={AtlasTableHandle}
          tableCellHandle={AtlasTableCellHandle}
          extendButton={AtlasExtendButton}
        />
      )}
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            getDefaultSlashMenuItems(editor)
              .filter((item) => item.key !== "emoji")
              .map((item) => {
                const Icon = blockIcons[item.key] ?? TextT;
                return { ...item, icon: <Icon size={18} aria-hidden="true" /> };
              }),
            query,
          )
        }
      />
    </ComponentsContext.Provider>
  );
}

function CheckboxItem({
  children,
  className,
  inset,
  ref,
  ...props
}: React.ComponentProps<typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuCheckboxItem>) {
  return (
    <Menu.CheckboxItem
      {...props}
      ref={ref}
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={(state) =>
        `relative flex items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-sm outline-hidden focus:bg-accent data-disabled:opacity-50 ${(typeof className === "function" ? className(state) : className) ?? ""}`
      }
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <Menu.CheckboxItemIndicator>
          <Check size={16} aria-hidden="true" />
        </Menu.CheckboxItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}
function SubTrigger({
  children,
  className,
  inset,
  ref,
  ...props
}: React.ComponentProps<typeof ShadCNDefaultComponents.DropdownMenu.DropdownMenuSubTrigger>) {
  return (
    <Menu.SubmenuTrigger
      {...props}
      ref={ref}
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={(state) =>
        `flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden focus:bg-accent data-popup-open:bg-accent ${(typeof className === "function" ? className(state) : className) ?? ""}`
      }
    >
      {children}
      <CaretRight size={16} className="ml-auto" aria-hidden="true" />
    </Menu.SubmenuTrigger>
  );
}

// BlockNote consumes a component registry, rather than a React component.
// eslint-disable-next-line react-refresh/only-export-components
export const atlasShadcnComponents = {
  DropdownMenu: {
    ...ShadCNDefaultComponents.DropdownMenu,
    DropdownMenuCheckboxItem: CheckboxItem,
    DropdownMenuSubTrigger: SubTrigger,
  },
};
