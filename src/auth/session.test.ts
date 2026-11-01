import { describe, expect, it, vi } from "vite-plus/test";
import { createSessionClient, SessionRequestError } from "./session";

const user = {
  id: "user_alice",
  email: "alice@example.test",
  firstName: "Alice",
  lastName: null,
};

describe("browser session client", () => {
  it("returns the validated browser user without accepting extra fields", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ user }));
    expect(await createSessionClient(request).read()).toEqual(user);
    const [url, init] = request.mock.calls[0];
    expect(url).toBe("/api/auth/session");
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a 401 as signed out", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } },
          { status: 401 },
        ),
      );
    expect(await createSessionClient(request).read()).toBeNull();
  });

  it("rejects malformed sessions and non-401 failures with their status", async () => {
    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ user: { ...user, token: "private" } }));
    await expect(createSessionClient(malformed).read()).rejects.toThrow(
      "Unexpected session response.",
    );
    const failed = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 }));
    const error = await createSessionClient(failed)
      .read()
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SessionRequestError);
    expect(error).toMatchObject({ status: 500 });
  });

  it("aborts a session check that exceeds its deadline", async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      );
      const pending = createSessionClient(request, 100).read();
      const rejected = expect(pending).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(100);
      await rejected;
      expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
