import { describe, expect, it, vi } from "vite-plus/test";
import { createNotesClient, NotesRequestError } from "./notes-store";

const id = "f0a10b01-4b98-4d4a-aabb-000000000001";
const note = {
  id,
  title: "Original",
  content: "  **literal**\n",
  createdAt: "2026-10-28T09:00:00.000Z",
  updatedAt: "2026-10-28T09:00:00.000Z",
};
const result = (etag: string, status = 200) =>
  Response.json(note, { status, headers: { ETag: etag } });

describe("notes REST client", () => {
  it("lists then opens an individual note and retains its exact strong ETag", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ notes: [note] }))
      .mockResolvedValueOnce(result('"opaque-17"'));
    const client = createNotesClient(request);
    expect(await client.list()).toEqual([note]);
    expect(await client.read(id)).toEqual({ note, etag: '"opaque-17"' });
    expect(request.mock.calls.map(([url]) => url)).toEqual(["/api/notes", `/api/notes/${id}`]);
    expect(request.mock.calls[1][1]).toMatchObject({
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
  });

  it("creates without an ID and updates with only editable fields and If-Match", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(result('"created"', 201))
      .mockResolvedValueOnce(result('"updated"'));
    const client = createNotesClient(request);
    const created = await client.create({
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
    });
    expect(created.etag).toBe('"created"');
    const updated = await client.update(
      created.note.id,
      { title: "Revised", content: "  keep whitespace\n" },
      created.etag,
    );
    expect(updated.etag).toBe('"updated"');
    const [createUrl, createInit] = request.mock.calls[0];
    expect(createUrl).toBe("/api/notes");
    expect(createInit?.method).toBe("POST");
    if (typeof createInit?.body !== "string") throw new Error("Expected JSON creation body");
    expect(JSON.parse(createInit.body)).toEqual({
      title: "Original",
      content: "  **literal**\n",
      createdAt: "2026-10-28T09:00:00.000Z",
    });
    const [updateUrl, updateInit] = request.mock.calls[1];
    expect(updateUrl).toBe(`/api/notes/${id}`);
    expect(updateInit?.method).toBe("PUT");
    expect(new Headers(updateInit?.headers).get("If-Match")).toBe('"created"');
    if (typeof updateInit?.body !== "string") throw new Error("Expected JSON update body");
    expect(JSON.parse(updateInit.body)).toEqual({
      title: "Revised",
      content: "  keep whitespace\n",
    });
  });

  it.each([null, 'W/"weak"', "*", '"one", "two"'])(
    "rejects missing or unsupported response ETags: %s",
    async (etag) => {
      const headers = new Headers();
      if (etag !== null) headers.set("ETag", etag);
      const client = createNotesClient(
        vi.fn<typeof fetch>().mockResolvedValue(Response.json(note, { headers })),
      );
      await expect(client.read(id)).rejects.toThrow();
    },
  );

  it("validates inputs before dispatching a write", async () => {
    const request = vi.fn<typeof fetch>();
    const client = createNotesClient(request);
    await expect(
      client.update(id, { title: "Bad tag", content: "" }, 'W/"weak"'),
    ).rejects.toThrow();
    await expect(
      client.create({ title: "x".repeat(257), content: "", createdAt: note.createdAt }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("returns a typed conflict without copying the provider message into the error", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "PRECONDITION_FAILED", message: "private provider detail" } },
          { status: 412 },
        ),
      );
    const client = createNotesClient(request);
    const error = await client
      .update(id, { title: "Local edit", content: "keep" }, '"old"')
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NotesRequestError);
    expect(error).toMatchObject({ status: 412, code: "PRECONDITION_FAILED" });
    expect(String(error)).not.toContain("private provider detail");
  });

  it("rejects malformed note bodies and a different note's identity", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { ...note, id: "f0a10b01-4b98-4d4a-aabb-000000000002" },
          { headers: { ETag: '"v1"' } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({ ...note, content: 42 }, { headers: { ETag: '"v2"' } }),
      );
    const client = createNotesClient(request);
    await expect(client.read(id)).rejects.toThrow("Unexpected note identity.");
    await expect(client.read(id)).rejects.toThrow();
  });
});

describe("bounded notes requests", () => {
  it.each(["list", "read", "create", "update"] as const)(
    "aborts a hung %s and ignores late success",
    async (operation) => {
      vi.useFakeTimers();
      try {
        let finish!: (response: Response) => void;
        const request = vi.fn<typeof fetch>(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
        const client = createNotesClient(request, 100);
        const pending =
          operation === "list"
            ? client.list()
            : operation === "read"
              ? client.read(id)
              : operation === "create"
                ? client.create({
                    title: note.title,
                    content: note.content,
                    createdAt: note.createdAt,
                  })
                : client.update(id, { title: note.title, content: note.content }, '"v1"');
        const rejected = expect(pending).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(100);
        await rejected;
        expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
        finish(result('"late"'));
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("bounds a stalled response body", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream()));
      const pending = createNotesClient(request, 100).list();
      const rejected = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
