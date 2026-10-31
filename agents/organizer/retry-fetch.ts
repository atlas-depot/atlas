import { setTimeout } from "node:timers/promises";

const retryableStatuses = new Set([429, 502, 503, 504]);
const maximumTimerDelay = 2_147_483_647;

function retryAfterMilliseconds(value: string | null, now: number): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Retries explicit transient HTTP failures, never an uncertain network outcome. */
export function createRetryFetch({
  fetchImpl = fetch,
  random = Math.random,
  now = Date.now,
  sleep = async (milliseconds, signal) => {
    await setTimeout(milliseconds, undefined, { signal });
  },
}: {
  fetchImpl?: typeof fetch;
  random?: () => number;
  now?: () => number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
} = {}): typeof fetch {
  return async (input, init) => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    // The OpenRouter JSON body is reusable. Do not replay arbitrary request/body streams.
    const replayable =
      (init?.body === undefined || init.body === null || typeof init.body === "string") &&
      (!(input instanceof Request) || input.body === null);
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      const response = await fetchImpl(input, init);
      if (attempt === 2 || !replayable || !retryableStatuses.has(response.status)) return response;

      const jitter = Math.floor(random() * Math.min(5_000, 500 * 2 ** attempt));
      const delay = Math.max(
        jitter,
        retryAfterMilliseconds(response.headers.get("retry-after"), now()) ?? 0,
      );
      // Node would truncate a larger delay to 1 ms, violating the provider's minimum wait.
      if (delay > maximumTimerDelay) return response;
      await response.body?.cancel();
      await sleep(delay, signal ?? undefined);
    }
  };
}
