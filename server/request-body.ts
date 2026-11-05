/** Bound actual bytes and total upload time, including requests without Content-Length. */
export async function readBody(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get("Content-Length")) > maxBytes) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let size = 0;
        let text = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) return text + decoder.decode();
          size += value.byteLength;
          if (size > maxBytes) return undefined;
          text += decoder.decode(value, { stream: true });
        }
      })(),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), 5_000);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
    // Do not wait on an uncooperative upload stream's cancellation hook.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readJson(request: Request): Promise<unknown> {
  // Allows the 100k UTF-16 content limit even when every character is JSON-escaped.
  const text = await readBody(request, 1024 * 1024);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function hasEmptyBody(request: Request): Promise<boolean> {
  if (Number(request.headers.get("Content-Length")) > 0) return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Node presents even bodyless POSTs as streams. Inspect without collecting bytes,
    // and bound empty/stalled uploads before any database or runtime work begins.
    return await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return true;
          if (value.byteLength > 0) return false;
        }
      })(),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 5_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    // Cancellation must not make a stalled uploader block the response again.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
