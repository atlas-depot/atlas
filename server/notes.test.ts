import { DrizzleQueryError } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import type { CreateNote, Note, NoteSummary } from "../shared/notes.ts";
import { requireAuth, type AuthEnv } from "./auth.ts";
import type { StoredNote } from "./db/notes.ts";
import { createNoteRoutes, type NoteService } from "./notes.ts";

const id = "130c3220-dc86-4fb0-828d-0338cae029d3";
const key = "99aa55aa-c790-4f68-bc57-00bf17324a29";
const owner = "verified-owner";
const input: CreateNote = {
  title: " Draft ",
  content: "# Source\n",
  createdAt: "2026-10-30T10:00:00.000Z",
};
const note: Note = { ...input, id, updatedAt: input.createdAt };
const summary: NoteSummary = {
  id,
  title: input.title,
  createdAt: input.createdAt,
  updatedAt: input.createdAt,
};
const stored: StoredNote = { note, revision: 7 };
const tag = `"${id}:7"`;
const edit = { title: "Edited", content: "New source" };

function service() {
  return {
    list: vi.fn<NoteService["list"]>().mockResolvedValue([summary]),
    read: vi.fn<NoteService["read"]>().mockResolvedValue(stored),
    createIdempotent: vi
      .fn<NoteService["createIdempotent"]>()
      .mockResolvedValue({ status: "saved", value: stored }),
    update: vi
      .fn<NoteService["update"]>()
      .mockResolvedValue({ status: "saved", value: { note: { ...note, ...edit }, revision: 8 } }),
    delete: vi.fn<NoteService["delete"]>().mockResolvedValue({ status: "deleted" }),
  };
}
function app(store?: NoteService, userId: string | null = owner) {
  const routes = new Hono<AuthEnv>();
  routes.use(
    "*",
    requireAuth(async () => (userId ? { userId } : null)),
  );
  routes.route("/notes", createNoteRoutes(store));
  return routes;
}
function request(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

afterEach(() => vi.useRealTimers());

describe("notes HTTP contract with a stubbed persistence boundary", () => {
  it.each(["GET", "POST", "PUT", "DELETE"])(
    "authenticates %s before storage/input checks",
    async (method) => {
      const store = service();
      const response = await app(store, null).request(
        method === "GET" || method === "POST" ? "/notes" : `/notes/${id}`,
        request(method),
      );
      expect(response.status).toBe(401);
      for (const operation of Object.values(store)) expect(operation).not.toHaveBeenCalled();
    },
  );

  it("returns sanitized 503 when storage is unconfigured", async () => {
    const response = await app().request("/notes");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "SERVICE_UNAVAILABLE", message: "Note storage is temporarily unavailable." },
    });
  });

  it("lists notes using only the verified owner and preserves source whitespace", async () => {
    const store = service();
    const response = await app(store).request("/notes?userId=forged", {
      headers: { "X-User-Id": "forged" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ notes: [summary] });
    expect(store.list).toHaveBeenCalledExactlyOnceWith(owner);
  });

  it("returns only public note fields and a strong per-note revision ETag", async () => {
    const store = service();
    const response = await app(store).request(`/notes/${id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(tag);
    expect(await response.json()).toEqual(note);
    expect(store.read).toHaveBeenCalledExactlyOnceWith(owner, id);
  });

  it("passes a canonical creation key to storage and returns identical replay responses", async () => {
    const store = service();
    const routes = app(store);
    const first = await routes.request(
      "/notes",
      request("POST", input, { "Idempotency-Key": key.toUpperCase() }),
    );
    const replay = await routes.request(
      "/notes",
      request("POST", input, { "Idempotency-Key": key }),
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(first.headers.get("ETag")).toBe(tag);
    expect(replay.headers.get("ETag")).toBe(tag);
    expect(await first.json()).toEqual(note);
    expect(await replay.json()).toEqual(note);
    expect(store.createIdempotent.mock.calls).toEqual([
      [owner, key, input],
      [owner, key, input],
    ]);
  });

  it.each([undefined, "not-a-uuid", `${key},${key}`])(
    "rejects invalid creation key %s before writing",
    async (header) => {
      const store = service();
      const response = await app(store).request(
        "/notes",
        request("POST", input, header ? { "Idempotency-Key": header } : {}),
      );
      expect(response.status).toBe(400);
      expect(store.createIdempotent).not.toHaveBeenCalled();
    },
  );

  it("exposes creation key conflicts as 409 without returning storage details", async () => {
    const store = service();
    store.createIdempotent.mockResolvedValue({ status: "conflict" });
    const response = await app(store).request(
      "/notes",
      request("POST", input, { "Idempotency-Key": key }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "CONFLICT" } });
  });

  it.each([
    { ...input, ownerId: "forged" },
    { ...input, revision: 100 },
    { ...input, createdAt: "not-a-date" },
    { ...input, title: "t".repeat(257) },
    { ...input, content: "x".repeat(100_001) },
  ])("rejects invalid or privileged create fields", async (body) => {
    const store = service();
    const response = await app(store).request(
      "/notes",
      request("POST", body, { "Idempotency-Key": key }),
    );
    expect(response.status).toBe(400);
    expect(store.createIdempotent).not.toHaveBeenCalled();
  });

  it("accepts maximum-size content even with JSON escaped code units", async () => {
    const store = service();
    const response = await app(store).request("/notes", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: `{"title":"","createdAt":"${input.createdAt}","content":"${"\\u0061".repeat(100_000)}"}`,
    });
    expect(response.status).toBe(201);
    expect(store.createIdempotent).toHaveBeenCalledWith(owner, key, {
      ...input,
      title: "",
      content: "a".repeat(100_000),
    });
  });

  it.each(["GET", "PUT", "DELETE"])("rejects malformed IDs for %s", async (method) => {
    const store = service();
    const response = await app(store).request(
      "/notes/not-a-uuid",
      request(method, method === "PUT" ? edit : undefined),
    );
    expect(response.status).toBe(400);
    expect(store.read).not.toHaveBeenCalled();
  });

  it.each(["GET", "PUT", "DELETE"])(
    "returns the same 404 for absent and inaccessible notes on %s",
    async (method) => {
      const store = service();
      store.read.mockImplementation(async (userId) => (userId === owner ? stored : undefined));
      const inaccessible = await app(store, "other-owner").request(
        `/notes/${id}`,
        request(method, method === "PUT" ? edit : undefined),
      );
      store.read.mockResolvedValue(undefined);
      const absent = await app(store).request(
        `/notes/${id}`,
        request(method, method === "PUT" ? edit : undefined),
      );
      expect(inaccessible.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(await inaccessible.json()).toEqual(await absent.json());
      expect(store.update).not.toHaveBeenCalled();
      expect(store.delete).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'W/"weak"', "*", '"a", "b"', "unquoted", '"other-id:7"', `"${id}:6"`])(
    "enforces strong exact If-Match %s",
    async (header) => {
      for (const method of ["PUT", "DELETE"]) {
        const store = service();
        const response = await app(store).request(
          `/notes/${id}`,
          request(
            method,
            method === "PUT" ? edit : undefined,
            header ? { "If-Match": header } : {},
          ),
        );
        expect(response.status).toBe(
          header === undefined
            ? 428
            : header === '"other-id:7"' || header === `"${id}:6"`
              ? 412
              : 400,
        );
        expect(store.update).not.toHaveBeenCalled();
        expect(store.delete).not.toHaveBeenCalled();
      }
    },
  );

  it("writes against the revision read and returns the replacement ETag", async () => {
    const store = service();
    const response = await app(store).request(
      `/notes/${id}`,
      request("PUT", edit, { "If-Match": tag }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(`"${id}:8"`);
    expect(await response.json()).toEqual({ ...note, ...edit });
    expect(store.update).toHaveBeenCalledExactlyOnceWith(owner, id, 7, edit);
  });

  it.each(["conflict", "not_found"] as const)(
    "handles atomic write %s after the initial read",
    async (status) => {
      for (const method of ["PUT", "DELETE"]) {
        const store = service();
        store.update.mockResolvedValue({ status });
        store.delete.mockResolvedValue({ status });
        const response = await app(store).request(
          `/notes/${id}`,
          request(method, method === "PUT" ? edit : undefined, { "If-Match": tag }),
        );
        expect(response.status).toBe(status === "conflict" ? 412 : 404);
      }
    },
  );

  it("rejects immutable fields on PUT", async () => {
    const store = service();
    const response = await app(store).request(
      `/notes/${id}`,
      request("PUT", input, { "If-Match": tag }),
    );
    expect(response.status).toBe(400);
    expect(store.update).not.toHaveBeenCalled();
  });

  it("accepts a Node-style empty DELETE stream and returns bodyless 204", async () => {
    const store = service();
    const response = await app(store).request(
      new Request(`http://localhost/notes/${id}`, {
        method: "DELETE",
        headers: { "If-Match": tag },
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(store.delete).toHaveBeenCalledExactlyOnceWith(owner, id, 7);
  });

  it("rejects any DELETE content before accessing storage", async () => {
    const store = service();
    const response = await app(store).request(
      `/notes/${id}`,
      request("DELETE", {}, { "If-Match": tag }),
    );
    expect(response.status).toBe(400);
    expect(store.read).not.toHaveBeenCalled();
  });

  it.each(["{broken", "null", "[]", ""])("rejects invalid JSON body %s", async (body) => {
    const store = service();
    const response = await app(store).request("/notes", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body,
    });
    expect(response.status).toBe(400);
    expect(store.createIdempotent).not.toHaveBeenCalled();
  });

  it("bounds actual streamed bytes even with a misleading Content-Length", async () => {
    const store = service();
    const response = await app(store).request("/notes", {
      method: "POST",
      headers: { "Idempotency-Key": key, "Content-Length": "1" },
      body: " ".repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(400);
    expect(store.createIdempotent).not.toHaveBeenCalled();
  });

  it.each(["POST", "DELETE"])(
    "cancels stalled %s bodies before storage is touched",
    async (method) => {
      vi.useFakeTimers();
      const store = service();
      const cancel = vi.fn();
      const response = app(store).request(
        new Request(`http://localhost/notes${method === "DELETE" ? `/${id}` : ""}`, {
          method,
          headers: { "Idempotency-Key": key, "If-Match": tag },
          body: new ReadableStream({ cancel }),
          duplex: "half",
        } as RequestInit),
      );
      await vi.advanceTimersByTimeAsync(5_001);
      expect((await response).status).toBe(400);
      expect(cancel).toHaveBeenCalledOnce();
      for (const operation of Object.values(store)) expect(operation).not.toHaveBeenCalled();
    },
  );

  it.each(["list", "read", "createIdempotent", "update", "delete"] as const)(
    "sanitizes %s storage errors and logs one content-free line",
    async (operation) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      onTestFinished(() => log.mockRestore());
      const store = service();
      store[operation].mockRejectedValue(new Error("DATABASE_URL=private-note-content"));
      const method =
        operation === "list" || operation === "read"
          ? "GET"
          : operation === "createIdempotent"
            ? "POST"
            : operation === "update"
              ? "PUT"
              : "DELETE";
      const path =
        operation === "list" || operation === "createIdempotent" ? "/notes" : `/notes/${id}`;
      const response = await app(store).request(
        path,
        request(method, method === "POST" ? input : method === "PUT" ? edit : undefined, {
          "If-Match": tag,
          "Idempotency-Key": key,
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: { code: "SERVICE_UNAVAILABLE", message: "Note storage is temporarily unavailable." },
      });
      expect(log).toHaveBeenCalledOnce();
      const line = String(log.mock.calls[0]?.[0]);
      expect(JSON.parse(line)).toEqual({
        event: "storage_failure",
        method,
        route: path === "/notes" ? "/notes" : "/notes/:id",
        name: "Error",
      });
      for (const value of [id, key, "Draft", "# Source", edit.content, "private-note-content"]) {
        expect(line).not.toContain(value);
      }
    },
  );

  it("logs the driver error, never Drizzle's parameter-bearing message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const store = service();
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    store.createIdempotent.mockRejectedValue(
      new DrizzleQueryError('insert into "notes"', [owner, input.title, input.content], cause),
    );
    const response = await app(store).request(
      "/notes",
      request("POST", input, { "Idempotency-Key": key }),
    );
    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toEqual({
      event: "storage_failure",
      method: "POST",
      route: "/notes",
      name: "Error",
      code: "ECONNREFUSED",
    });
    for (const value of [owner, "Draft", "# Source", "insert into"]) {
      expect(line).not.toContain(value);
    }
  });
});
