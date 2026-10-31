import { useState } from "react";
import { NotesWorkspace } from "./NotesWorkspace";
import { createPreviewStore } from "./example-notes";

export function ExampleNotes() {
  const [store] = useState(() =>
    createPreviewStore(new URLSearchParams(window.location.search).get("notesExample")),
  );
  return <NotesWorkspace store={store} example />;
}
