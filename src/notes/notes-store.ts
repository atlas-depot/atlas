import { noteListSchema, noteSchema, type Note } from "../../shared/notes";

/** UI seam for #52. Implementations must return validated server results when connected. */
export interface NotesStore {
  list(): Promise<Note[]>;
  save(note: Note): Promise<Note>;
}

export const disconnectedNotesStore: NotesStore = {
  async list() {
    throw new Error("Notes are not connected yet.");
  },
  async save() {
    throw new Error("Notes are not connected yet.");
  },
};

/** Synthetic, tab-memory-only storage. Used exclusively by the development/test preview. */
export function createExampleNotesStore(initial: Note[]): NotesStore {
  let notes = noteListSchema.parse({ notes: initial }).notes;
  return {
    async list() {
      return notes.map((note) => ({ ...note }));
    },
    async save(input) {
      const exists = notes.some((note) => note.id === input.id);
      const note = noteSchema.parse({
        ...input,
        updatedAt: exists ? new Date().toISOString() : input.createdAt,
      });
      notes = [note, ...notes.filter((existing) => existing.id !== note.id)];
      return { ...note };
    },
  };
}
