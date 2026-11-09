/**
 * Bounds header and body delivery. After the timeout the request is aborted and
 * a late response is ignored, so it cannot update the screen.
 */
export async function boundedFetch(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  request: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The request timed out."));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const result = await request(path, { ...init, signal: controller.signal });
        // Read the whole body inside the bound, then hand back a settled copy.
        const body = await result.arrayBuffer();
        return new Response(body.byteLength ? body : null, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        });
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
