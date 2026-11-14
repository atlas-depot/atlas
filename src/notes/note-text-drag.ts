import { useEffect, type DragEvent as ReactDragEvent, type RefObject } from "react";

const noteSelectionType = "application/x-atlas-note-selection";

export function markNoteSelection(event: ReactDragEvent) {
  const target = event.target;
  const element =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const editor = element?.closest('.bn-editor[contenteditable="true"]');
  const selection = window.getSelection();
  if (
    editor &&
    selection &&
    !selection.isCollapsed &&
    editor.contains(selection.anchorNode) &&
    editor.contains(selection.focusNode)
  ) {
    event.dataTransfer.setData(noteSelectionType, "1");
  }
}

export function allowNoteCopy(event: ReactDragEvent<HTMLTextAreaElement>) {
  if (!event.dataTransfer.types.includes(noteSelectionType)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
}

function copyNoteToComposer(input: HTMLTextAreaElement, event: DragEvent) {
  if (event.target !== input || !event.dataTransfer?.types.includes(noteSelectionType)) return;
  // BlockNote handles document-capture drops outside its editor by moving the selection back into it.
  event.stopPropagation();
  event.preventDefault();
  if (input.disabled) return;
  // BlockNote serializes extra line breaks between selected blocks in text/plain.
  const text =
    input.ownerDocument.getSelection()?.toString() || event.dataTransfer.getData("text/plain");
  if (!text) return;
  const caret = input.ownerDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
  input.focus();
  if (caret?.offsetNode === input) {
    const insideSelection =
      input.selectionStart <= caret.offset && caret.offset <= input.selectionEnd;
    if (!insideSelection) input.setSelectionRange(caret.offset, caret.offset);
  }
  // The native editing command honors maxLength and gives the drop one undo step.
  input.ownerDocument.execCommand("insertText", false, text);
}

export function useNoteTextDrop(inputRef: RefObject<HTMLTextAreaElement | null>) {
  useEffect(() => {
    function handleDrop(event: DragEvent) {
      if (inputRef.current) copyNoteToComposer(inputRef.current, event);
    }
    window.addEventListener("drop", handleDrop, true);
    return () => window.removeEventListener("drop", handleDrop, true);
  }, [inputRef]);
}
