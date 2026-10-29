import type { Note } from "../../shared/notes";
import { createExampleNotesStore, type NotesStore } from "./notes-store";

const exampleNotes: Note[] = [
  {
    id: "f0a10b01-4b98-4d4a-aabb-000000000001",
    title: "Project review",
    content:
      "# Project review\n\nPrepare the **budget summary** before the review.\n\n- Check the figures\n- Share the draft\n\n> Synthetic example, written as a user note.\n\n| Item | Owner |\n| --- | --- |\n| Summary | Deniz |\n\n[Project repository](https://github.com/atlas-depot/atlas)\n\n```ts\nconst ready = true;\n```",
    createdAt: "2026-10-28T09:00:00.000Z",
    updatedAt: "2026-10-28T09:00:00.000Z",
  },
  {
    id: "f0a10b01-4b98-4d4a-aabb-000000000002",
    title: "Reading notes",
    content: "## Next steps\n\nKeep the original Markdown source, including *emphasis*.\n",
    createdAt: "2026-10-28T10:00:00.000Z",
    updatedAt: "2026-10-28T10:00:00.000Z",
  },
];

/** Development/test fixtures only; the normal build does not enable this entrypoint. */
export function createPreviewStore(scenario: string | null): NotesStore {
  const store = createExampleNotesStore(scenario === "empty" ? [] : exampleNotes);
  let failLoad = scenario === "load-failure";
  let failSave = scenario === "save-failure";
  let loading: Promise<Note[]> | null = null;
  const wait = () =>
    new Promise<void>((resolve) => setTimeout(resolve, scenario === "slow-save" ? 1500 : 300));
  return {
    list() {
      if (loading) return loading;
      loading = (async () => {
        await wait();
        if (failLoad) {
          failLoad = false;
          throw new Error("Synthetic load failure");
        }
        return store.list();
      })();
      void loading.then(
        () => {
          loading = null;
        },
        () => {
          loading = null;
        },
      );
      return loading;
    },
    async save(note) {
      await wait();
      if (failSave) {
        failSave = false;
        throw new Error("Synthetic save failure");
      }
      return store.save(note);
    },
  };
}
