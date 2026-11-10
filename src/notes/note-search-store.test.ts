import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { NotesRequestError } from "./notes-store";
import { createNoteSearchClient } from "./note-search-store";

const noteId = "f0a10b01-4b98-4d4a-aabb-000000000001";
const searchResult = {
  candidates: [
    {
      text: "Keyboard shortcuts keep editing fast.",
      score: 0.91,
      source: {
        kind: "block" as const,
        noteId,
        version: `"${noteId}:2"`,
        blockId: "block-1",
        headingPath: ["Navigation"],
      },
    },
  ],
  coverage: {
    ready: 3,
    pending: 0,
    failed: 0,
  },
};

describe("note search REST client", () => {
  it("posts a validated search query same-origin with an abort signal", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(searchResult));
    const response = await createNoteSearchClient(request).search("keyboard shortcuts", 5);
    expect(response).toEqual(searchResult);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("/api/note-search");
    expect(init?.method).toBe("POST");
    expect(init).toMatchObject({ credentials: "same-origin", signal: expect.any(AbortSignal) });
    if (typeof init?.body !== "string") throw new Error("Expected JSON search body");
    expect(JSON.parse(init.body)).toEqual({ query: "keyboard shortcuts", limit: 5 });
  });

  it("validates query and limit before dispatching a network request", async () => {
    const request = vi.fn<typeof fetch>();
    const client = createNoteSearchClient(request);
    await expect(client.search("   ")).rejects.toThrow();
    await expect(client.search("valid", 99)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("maps structured API errors to NotesRequestError without copying provider details", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "private provider detail",
          },
        },
        { status: 503 },
      ),
    );
    const error = await createNoteSearchClient(request)
      .search("shortcuts")
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NotesRequestError);
    expect(error).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(String(error)).not.toContain("private provider detail");
  });

  it("maps unrecognized error responses to INVALID_RESPONSE", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("Bad gateway", { status: 502 }));
    await expect(createNoteSearchClient(request).search("shortcuts")).rejects.toMatchObject({
      status: 502,
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects malformed success responses", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ candidates: [{ invalid: true }], coverage: {} }));
    await expect(createNoteSearchClient(request).search("shortcuts")).rejects.toBeInstanceOf(
      z.ZodError,
    );
  });

  it("aborts a search request still pending after 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const pending = createNoteSearchClient(request).search("shortcuts");
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
});
