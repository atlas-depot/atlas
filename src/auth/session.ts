import { sessionResponseSchema, type SessionUser } from "../../shared/auth";

export class SessionRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("The session request did not succeed.");
    this.name = "SessionRequestError";
    this.status = status;
  }
}

/** Same-origin session probe. A 401 means signed out; other failures must not erase a known user. */
export function createSessionClient(request: typeof fetch = globalThis.fetch, timeoutMs = 30_000) {
  return {
    async read(): Promise<SessionUser | null> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await request("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (result.status === 401) return null;
        if (!result.ok) throw new SessionRequestError(result.status);
        const body = sessionResponseSchema.safeParse(await result.json().catch(() => null));
        if (!body.success) throw new Error("Unexpected session response.");
        return body.data.user;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
