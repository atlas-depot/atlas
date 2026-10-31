import { apiError, ifMatchSchema } from "../../shared/http";
import { createNoteSchema, updateNoteSchema, type Note } from "../../shared/notes";
import { createNotesClient } from "./notes-store";

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

/** Development-only HTTP fixtures feeding the same Zod-validating client and editor. */
export function createPreviewStore(scenario: string | null) {
  const notes = new Map(
    (scenario === "empty" ? [] : exampleNotes).map((note) => [note.id, { ...note }]),
  );
  const versions = new Map([...notes.keys()].map((id) => [id, 1]));
  let failLoad = scenario === "load-failure";
  let failSave = scenario === "save-failure";
  let failRead = scenario === "read-failure";
  let conflict = scenario === "conflict";
  const tag = (id: string) => `"${id}-v${versions.get(id)}"`;
  const fail = (status: number, code: Parameters<typeof apiError>[0]) =>
    Response.json(apiError(code, "Synthetic request failure."), { status });
  const noteResponse = (note: Note, status = 200) =>
    Response.json(note, { status, headers: { ETag: tag(note.id) } });
  const respond: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.pathname
          : new URL(input.url).pathname;
    const method = init?.method ?? "GET";
    const id = url.startsWith("/api/notes/") ? url.slice("/api/notes/".length) : null;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, scenario === "slow-save" && method !== "GET" ? 1500 : 150),
    );
    if (method === "GET" && id === null) {
      if (scenario === "unavailable") return fail(501, "NOT_IMPLEMENTED");
      if (scenario === "unauthenticated") return fail(401, "UNAUTHENTICATED");
      if (failLoad) {
        failLoad = false;
        return fail(500, "INTERNAL_ERROR");
      }
      return Response.json({
        notes: [...notes.values()].map((note) => ({
          ...note,
          content: "List record only. Open this note to edit it.",
        })),
      });
    }
    if (method === "GET" && id !== null) {
      if (scenario === "missing-read") return fail(404, "NOT_FOUND");
      if (failRead) {
        failRead = false;
        return fail(500, "INTERNAL_ERROR");
      }
      const note = notes.get(id);
      return note ? noteResponse(note) : fail(404, "NOT_FOUND");
    }
    if (scenario === "expired-save") return fail(401, "UNAUTHENTICATED");
    if (scenario === "forbidden-save") return fail(403, "FORBIDDEN");
    if (scenario === "missing-save" && id !== null && notes.has(id)) {
      notes.delete(id);
      return fail(404, "NOT_FOUND");
    }
    if (failSave) {
      failSave = false;
      return fail(500, "INTERNAL_ERROR");
    }
    if (typeof init?.body !== "string") return fail(400, "VALIDATION_ERROR");
    let body: unknown;
    try {
      body = JSON.parse(init.body);
    } catch {
      return fail(400, "VALIDATION_ERROR");
    }
    if (method === "POST" && id === null) {
      const parsed = createNoteSchema.safeParse(body);
      if (!parsed.success) return fail(400, "VALIDATION_ERROR");
      const note = { ...parsed.data, id: crypto.randomUUID(), updatedAt: parsed.data.createdAt };
      notes.set(note.id, note);
      versions.set(note.id, 1);
      return noteResponse(note, 201);
    }
    if (method === "PUT" && id !== null) {
      const note = notes.get(id);
      if (!note) return fail(404, "NOT_FOUND");
      const header = new Headers(init?.headers).get("If-Match");
      if (header === null) return fail(428, "PRECONDITION_REQUIRED");
      if (!ifMatchSchema.safeParse(header).success) return fail(400, "VALIDATION_ERROR");
      if (conflict) {
        conflict = false;
        notes.set(id, { ...note, content: "A newer version saved by another client." });
        versions.set(id, (versions.get(id) ?? 1) + 1);
      }
      if (header !== tag(id)) return fail(412, "PRECONDITION_FAILED");
      const parsed = updateNoteSchema.safeParse(body);
      if (!parsed.success) return fail(400, "VALIDATION_ERROR");
      const result = { ...note, ...parsed.data, updatedAt: new Date().toISOString() };
      notes.set(id, result);
      versions.set(id, (versions.get(id) ?? 1) + 1);
      return noteResponse(result);
    }
    return fail(400, "VALIDATION_ERROR");
  };
  // Share concurrent development GETs (including StrictMode's mount probe), but never cache data or coalesce writes.
  const reads = new Map<string, Promise<Response>>();
  const transport: typeof fetch = (input, init) => {
    if (typeof input !== "string" || (init?.method ?? "GET") !== "GET") return respond(input, init);
    let pending = reads.get(input);
    if (!pending) {
      pending = respond(input, init);
      reads.set(input, pending);
      void pending.then(
        () => reads.delete(input),
        () => reads.delete(input),
      );
    }
    return pending.then((response) => response.clone());
  };
  return createNotesClient(transport);
}
