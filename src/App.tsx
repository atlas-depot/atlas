import { lazy, Suspense } from "react";
import { AuthenticatedNotes } from "./auth/AuthenticatedNotes";
import { createNotesClient } from "./notes/notes-store";

const notesClient = createNotesClient();

const exampleEnabled = import.meta.env.DEV || import.meta.env.VITE_NOTES_DEMO === "true";
const ExampleNotes = exampleEnabled
  ? lazy(() => import("./notes/ExampleNotes").then((module) => ({ default: module.ExampleNotes })))
  : null;
const BriefingExample = exampleEnabled
  ? lazy(() => import("./BriefingExample").then((module) => ({ default: module.BriefingExample })))
  : null;

export function App() {
  if (
    BriefingExample &&
    new URLSearchParams(window.location.search).get("example") === "briefing"
  ) {
    return (
      <Suspense fallback={<p role="status">Loading example...</p>}>
        <BriefingExample />
      </Suspense>
    );
  }
  return (
    <>
      {ExampleNotes ? (
        <Suspense fallback={<p role="status">Loading notes...</p>}>
          <ExampleNotes />
        </Suspense>
      ) : (
        <AuthenticatedNotes store={notesClient} />
      )}
    </>
  );
}
