import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, embedMany, InvalidResponseDataError } from "ai";
import { z } from "zod";
import { noteTextSchema } from "../../shared/document.ts";
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  embeddingVectorSchema,
} from "../../shared/embedding.ts";

const inputsSchema = z.array(noteTextSchema.min(1).max(100_000)).max(1_000);
const responseSchema = z.object({
  model: z.literal(EMBEDDING_MODEL),
  data: z.array(
    z.object({ index: z.number().int().nonnegative(), embedding: embeddingVectorSchema }),
  ),
});

/** Safe to persist as failure metadata. Provider errors may contain the note or credentials. */
export class NoteEmbeddingError extends Error {
  readonly code: "invalid_embedding" | "provider_unavailable";

  constructor(code: NoteEmbeddingError["code"]) {
    super(code === "invalid_embedding" ? "Invalid embedding response." : "Embedding unavailable.");
    this.name = "NoteEmbeddingError";
    this.code = code;
  }
}

export function createNoteEmbedder(options: { apiKey: string; fetch?: typeof fetch }) {
  if (!options.apiKey.trim()) throw new NoteEmbeddingError("provider_unavailable");
  const provider = createOpenRouter({ apiKey: options.apiKey, fetch: options.fetch });
  const model = provider.textEmbeddingModel(EMBEDDING_MODEL, {
    extraBody: { dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float" },
    provider: { require_parameters: true },
  });

  return async (texts: string[], signal?: AbortSignal): Promise<number[][]> => {
    const parsed = inputsSchema.safeParse(texts);
    if (!parsed.success) throw new TypeError("Embedding input is invalid.");
    const embeddings: number[][] = [];
    // This provider declares no batch limit. Keep requests bounded and preserve repeated inputs.
    for (let offset = 0; offset < parsed.data.length; offset += 16) {
      try {
        signal?.throwIfAborted();
        const batch = parsed.data.slice(offset, offset + 16);
        const result = await embedMany({
          model,
          values: batch,
          maxParallelCalls: 1,
          maxRetries: 0,
          abortSignal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
          telemetry: { isEnabled: false },
        });
        const response = responseSchema.safeParse(result.responses?.[0]?.body);
        if (
          result.responses?.length !== 1 ||
          !response.success ||
          response.data.data.length !== batch.length ||
          new Set(response.data.data.map((item) => item.index)).size !== batch.length ||
          response.data.data.some((item) => item.index >= batch.length)
        ) {
          throw new NoteEmbeddingError("invalid_embedding");
        }
        // The installed provider maps response order, ignoring index. Bind each vector to its input.
        embeddings.push(
          ...response.data.data.sort((a, b) => a.index - b.index).map((item) => item.embedding),
        );
      } catch (error) {
        if (error instanceof NoteEmbeddingError) throw error;
        const invalid =
          InvalidResponseDataError.isInstance(error) ||
          (APICallError.isInstance(error) && error.statusCode === 200);
        // Do not attach the original error as cause or serialize its response/request body.
        throw new NoteEmbeddingError(invalid ? "invalid_embedding" : "provider_unavailable");
      }
    }
    return embeddings;
  };
}
