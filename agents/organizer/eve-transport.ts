import { Client, ClientError, type ClientSession } from "eve/client";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";

export const sessionIdSchema = z.string().min(1).max(512);
export const deliveryReceiptSchema = z.object({
  sessionId: sessionIdSchema,
  deliveryId: z.string().min(1).max(512),
});
export type SessionReader = Pick<ClientSession, "snapshot" | "end">;
export type ReaderClient = { sessions: { attach(sessionId: string): SessionReader } };
/** The fixed session can no longer accept input. Never answered by starting a replacement. */
export class ExpiredSubmission extends Error {}
/** The runtime refused this input outright. Sending it again cannot succeed. */
export class RejectedSubmission extends Error {}

export type EveTransportOptions = {
  /** Use an immutable deployment URL for work that must survive a later deployment. */
  baseUrl: string;
  serviceToken: string;
  /** Service username. It selects the job the runtime performs for this caller. */
  username: string;
  deploymentProtectionSecret?: string;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  client?: ReaderClient;
};

export function expired(error: unknown): boolean {
  return ClientError.is(error) && error.status === 410 && error.code === "session_expired";
}

/** Authenticated short requests to one private eve deployment. Holds no run state. */
export function createEveTransport({
  baseUrl,
  serviceToken,
  username,
  deploymentProtectionSecret,
  requestTimeoutMs = 15_000,
  fetchImpl = fetch,
  client,
}: EveTransportOptions) {
  const endpoint = new URL(baseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    serviceToken.length < 32
  ) {
    throw new Error("Organizer endpoint or service credential is invalid.");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 2_147_483_647
  ) {
    throw new Error("Organizer request and model-call limits must be positive integers.");
  }
  const url = `${endpoint.href.replace(/\/$/, "")}/eve/v1/session`;
  const deploymentHeaders: Record<string, string> = deploymentProtectionSecret
    ? { "x-vercel-protection-bypass": deploymentProtectionSecret }
    : {};
  const reader =
    client ??
    new Client({
      baseUrl: endpoint.href.replace(/\/$/, ""),
      auth: { basic: { username, password: serviceToken } },
      headers: deploymentHeaders,
      redirect: "error",
    });
  const timeout = () => AbortSignal.timeout(requestTimeoutMs);

  const post = async (target: string, body: unknown, signal: AbortSignal): Promise<unknown> => {
    const response = await fetchImpl(target, {
      method: "POST",
      headers: {
        ...deploymentHeaders,
        authorization: `Basic ${Buffer.from(`${username}:${serviceToken}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    if (response.status !== 202) {
      if (response.status === 409 || response.status === 410) {
        const error = z.object({ code: z.string() }).safeParse(await response.json());
        if (
          error.success &&
          ((response.status === 410 && error.data.code === "session_expired") ||
            (response.status === 409 && error.data.code === "session_not_active"))
        )
          throw new ExpiredSubmission();
      }
      await response.body?.cancel();
      // Repeating a request the runtime refuses for its size can never succeed.
      if (response.status === 413) throw new RejectedSubmission();
      throw new Error();
    }
    return await response.json();
  };

  return {
    timeout,
    reader,
    /** Confirms one empty session for a stable operation ID. No model input is sent. */
    async allocate(operationId: string): Promise<string> {
      if (!operationId || operationId.length > 256)
        throw new Error("Invalid organizer operation ID.");
      const signal = timeout();
      const candidates = new Set<string>();
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = z
          .object({ sessionId: sessionIdSchema })
          .parse(await post(url, { operationId }, signal));
        // Empty creates can race and return different candidate IDs. Seeing a previous ID
        // again confirms the operation now resolves to that canonical owner. No model ran.
        if (candidates.has(result.sessionId)) return result.sessionId;
        candidates.add(result.sessionId);
        if (attempt < 4) await delay(100, undefined, { signal });
      }
      throw new Error();
    },

    /** Sends one input to a fixed session. The key makes an uncertain send safe to repeat. */
    async deliver(sessionId: string, body: Record<string, unknown> & { idempotencyKey: string }) {
      sessionIdSchema.parse(sessionId);
      if (!body.idempotencyKey || body.idempotencyKey.length > 256)
        throw new Error("Invalid organizer operation ID.");
      const result = deliveryReceiptSchema.parse(
        await post(`${url}/${encodeURIComponent(sessionId)}`, body, timeout()),
      );
      if (result.sessionId !== sessionId) throw new Error();
      return result;
    },

    /** Submit end once, then independently verify durable history. A lost receipt is retryable. */
    async retire(sessionId: string, reason: string): Promise<{ status: "ended" | "expired" }> {
      const session = reader.sessions.attach(sessionIdSchema.parse(sessionId));
      try {
        await session.end({ reason, signal: timeout() });
      } catch (error) {
        if (expired(error)) return { status: "expired" };
        // Inactive or a lost response alone does not establish completed cleanup.
      }
      try {
        const snapshot = await session.snapshot({ signal: timeout() });
        if (snapshot.events.some((event) => event.type === "session.ended"))
          return { status: "ended" };
      } catch (error) {
        if (expired(error)) return { status: "expired" };
      }
      throw new Error();
    },
  };
}
