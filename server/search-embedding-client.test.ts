import { expect, it, vi } from "vite-plus/test";
import { EMBEDDING_DIMENSIONS } from "../shared/embedding.ts";
import { createSearchEmbeddingClient } from "./search-embedding-client.ts";

const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));
const token = "synthetic-service-token-".repeat(2);

it("sends a bounded query only to the pinned private runtime", async () => {
  const requests: Request[] = [];
  const embed = createSearchEmbeddingClient({
    baseUrl: "https://private-runtime.example",
    serviceToken: token,
    deploymentProtectionSecret: "synthetic-protection",
    fetchImpl: async (input, init) => {
      requests.push(new Request(input, init));
      return Response.json({ embedding: vector() });
    },
  });
  expect(await embed("  Bir not bul  ")).toEqual(vector());
  expect(requests).toHaveLength(1);
  expect(requests[0].url).toBe("https://private-runtime.example/internal/note-search/embed");
  expect(await requests[0].json()).toEqual({ query: "Bir not bul" });
  expect(requests[0].headers.get("authorization")).toBe(
    `Basic ${Buffer.from(`atlas-api:${token}`).toString("base64")}`,
  );
  expect(requests[0].headers.get("x-vercel-protection-bypass")).toBe("synthetic-protection");
  expect(requests[0].redirect).toBe("error");
  expect(requests[0].credentials).toBe("omit");
  expect(requests[0].cache).toBe("no-store");
});

it("rejects invalid queries before transport and sanitizes remote failures", async () => {
  const fetchImpl = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("PRIVATE provider detail", { status: 503 }));
  const embed = createSearchEmbeddingClient({
    baseUrl: "https://private-runtime.example",
    serviceToken: token,
    fetchImpl,
  });
  await expect(embed(" ")).rejects.toThrow();
  await expect(embed("x".repeat(501))).rejects.toThrow();
  await expect(embed("find\0note")).rejects.toThrow();
  await expect(embed("find\ud800note")).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(embed("find note")).rejects.toThrow("Search embedding is unavailable.");
  for (const bad of [{ embedding: [1] }, { embedding: vector(), extra: "private" }]) {
    fetchImpl.mockResolvedValueOnce(Response.json(bad));
    await expect(embed("find note")).rejects.toThrow("Search embedding is unavailable.");
  }
});
