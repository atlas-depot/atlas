import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { NotesRequestError } from "./notes-store";
import { createOrganizeClient } from "./organize-store";

const noteId = "f0a10b01-4b98-4d4a-aabb-000000000001";
const runId = "f0a10b01-4b98-4d4a-aabb-000000000002";
const draftId = "f0a10b01-4b98-4d4a-aabb-000000000003";
const savedId = "f0a10b01-4b98-4d4a-aabb-000000000004";
const draft = {
  id: draftId,
  etag: '"draft-v1"',
  title: "Organized",
  content: "  # Organized\n",
  source: { noteId, revision: 3, stale: false, deleted: false },
  sources: [{ id: "s1", url: "https://example.test/a", title: "Source A" }],
  expiresAt: "2026-11-10T09:00:00.000Z",
  updatedAt: "2026-11-09T09:00:00.000Z",
};
const edit = { title: "Revised", content: "  keep whitespace\n" };
const draftResponse = (value = draft) => Response.json(value, { headers: { ETag: value.etag } });

describe("organize REST client", () => {
  it("lists organize work same-origin with an abort signal", async () => {
    const work = { runs: [{ runId, noteId }], drafts: [draft] };
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(work));
    expect(await createOrganizeClient(request).list()).toEqual(work);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("/api/organize-work");
    expect(init?.method).toBeUndefined();
    expect(init).toMatchObject({ credentials: "same-origin", signal: expect.any(AbortSignal) });
  });

  it("starts a run on the note with its If-Match tag", async () => {
    const started = { runId, status: "accepted" };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(started, { status: 202 }));
    expect(await createOrganizeClient(request).start(noteId, '"note-v4"')).toEqual(started);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`/api/notes/${noteId}/organize`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("If-Match")).toBe('"note-v4"');
    expect(init?.body).toBeUndefined();
  });

  it("reads and cancels a run by its id", async () => {
    const running = { runId, status: "running", phase: "researching" };
    const cancelled = { runId, status: "cancelled" };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(running))
      .mockResolvedValueOnce(Response.json(cancelled));
    const client = createOrganizeClient(request);
    expect(await client.readRun(runId)).toEqual(running);
    expect(await client.cancel(runId)).toEqual(cancelled);
    expect(request.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`/api/organize-runs/${runId}`, undefined],
      [`/api/organize-runs/${runId}/cancel`, "POST"],
    ]);
  });

  it("hands off a run and reads a draft whose body tag matches its ETag", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(draftResponse())
      .mockResolvedValueOnce(draftResponse());
    const client = createOrganizeClient(request);
    expect(await client.handoff(runId)).toEqual(draft);
    expect(await client.readDraft(draftId)).toEqual(draft);
    expect(request.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`/api/organize-runs/${runId}/handoff`, "POST"],
      [`/api/note-drafts/${draftId}`, undefined],
    ]);
  });

  it("rejects a draft whose ETag header names another revision", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(draft, { headers: { ETag: '"draft-v2"' } }));
    await expect(createOrganizeClient(request).readDraft(draftId)).rejects.toThrow(
      "Unexpected draft revision.",
    );
  });

  it("updates a draft with only the editable fields and If-Match", async () => {
    const updated = { ...draft, ...edit, etag: '"draft-v2"' };
    const request = vi.fn<typeof fetch>().mockResolvedValue(draftResponse(updated));
    expect(await createOrganizeClient(request).updateDraft(draftId, edit, '"draft-v1"')).toEqual(
      updated,
    );
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`/api/note-drafts/${draftId}`);
    expect(init?.method).toBe("PUT");
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("If-Match")).toBe('"draft-v1"');
    if (typeof init?.body !== "string") throw new Error("Expected JSON update body");
    expect(JSON.parse(init.body)).toEqual(edit);
  });

  it("discards a draft with If-Match and accepts an empty 204", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      createOrganizeClient(request).discard(draftId, '"draft-v1"'),
    ).resolves.toBeUndefined();
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`/api/note-drafts/${draftId}`);
    expect(init?.method).toBe("DELETE");
    expect(new Headers(init?.headers).get("If-Match")).toBe('"draft-v1"');
    expect(init?.body).toBeUndefined();
  });

  it("saves a draft as a note through POST and returns the note's ETag", async () => {
    const saved = {
      id: savedId,
      ...edit,
      origin: { sourceNoteId: noteId, sourceRevision: 3, sources: draft.sources },
      createdAt: "2026-11-09T09:30:00.000Z",
      updatedAt: "2026-11-09T09:30:00.000Z",
    };
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(saved, { status: 201, headers: { ETag: '"saved-v1"' } }));
    expect(await createOrganizeClient(request).save(draftId, edit, '"draft-v1"')).toEqual({
      note: saved,
      etag: '"saved-v1"',
    });
    const [url, init] = request.mock.calls[0];
    expect(url).toBe(`/api/note-drafts/${draftId}/save`);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("If-Match")).toBe('"draft-v1"');
    if (typeof init?.body !== "string") throw new Error("Expected JSON save body");
    expect(JSON.parse(init.body)).toEqual(edit);
  });

  it("returns a typed API error without copying the provider message", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "PRECONDITION_FAILED", message: "private provider detail" } },
          { status: 412 },
        ),
      );
    const error = await createOrganizeClient(request)
      .updateDraft(draftId, edit, '"draft-v1"')
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NotesRequestError);
    expect(error).toMatchObject({ status: 412, code: "PRECONDITION_FAILED" });
    expect(String(error)).not.toContain("private provider detail");
  });

  it("maps an unrecognized error body to INVALID_RESPONSE", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    await expect(createOrganizeClient(request).list()).rejects.toMatchObject({
      status: 502,
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects a success body that fails its schema", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ runs: [{ runId: "not-a-uuid", noteId }], drafts: [] }));
    await expect(createOrganizeClient(request).list()).rejects.toBeInstanceOf(z.ZodError);
  });

  it("validates ids, tags and draft content before dispatching", async () => {
    const request = vi.fn<typeof fetch>();
    const client = createOrganizeClient(request);
    await expect(client.readRun("../note-drafts/x")).rejects.toThrow();
    await expect(client.start(noteId, 'W/"weak"')).rejects.toThrow();
    await expect(
      client.updateDraft(draftId, { ...edit, title: "x".repeat(257) }, '"draft-v1"'),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

it("aborts a request still pending after 30 seconds", async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = createOrganizeClient(request).list();
    const rejected = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
