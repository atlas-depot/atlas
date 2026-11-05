import { Combobox } from "@base-ui/react/combobox";
import { CaretDown, Check, MagnifyingGlass } from "@phosphor-icons/react";
import { codeLanguageChoices } from "./code-theme";

type Language = (typeof codeLanguageChoices)[number];

/** Select a declared language. Filtering includes grammar IDs and common aliases. */
export function CodeLanguagePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (language: string) => void;
  disabled?: boolean;
}) {
  const selected =
    codeLanguageChoices.find(
      (language) => language.id === value || language.aliases.includes(value),
    ) ?? null;
  return (
    <div className="code-language-picker" contentEditable={false}>
      <Combobox.Root<Language>
        items={codeLanguageChoices}
        value={selected}
        disabled={disabled}
        itemToStringLabel={(language) => language.name}
        itemToStringValue={(language) => language.id}
        isItemEqualToValue={(left, right) => left.id === right.id}
        filter={(language, query) => {
          const needle = query.trim().toLocaleLowerCase();
          return [language.id, language.name, ...language.aliases].some((label) =>
            label.toLocaleLowerCase().includes(needle),
          );
        }}
        onValueChange={(language) => {
          // Base UI emits item-press even when selecting the current value. The
          // host can therefore lock an explicit Plain text choice against detection.
          if (language) onChange(language.id);
        }}
        autoHighlight
      >
        <Combobox.Trigger className="code-language-trigger" aria-label="Code language">
          <span>{selected?.name ?? (value || "Plain text")}</span>
          <CaretDown size={14} aria-hidden="true" />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner align="start" sideOffset={6} className="code-language-positioner">
            <Combobox.Popup className="code-language-popup" aria-label="Choose code language">
              <div className="code-language-search">
                <MagnifyingGlass size={16} aria-hidden="true" />
                <Combobox.Input
                  aria-label="Search code languages"
                  placeholder="Search languages…"
                />
              </div>
              <Combobox.Empty className="code-language-empty">No matching languages</Combobox.Empty>
              <Combobox.List className="code-language-list">
                {(language: Language) => (
                  <Combobox.Item key={language.id} value={language} className="code-language-item">
                    <span>{language.name}</span>
                    <Combobox.ItemIndicator>
                      <Check size={16} aria-hidden="true" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
