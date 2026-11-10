import { defineChannel, POST } from "eve/channels";
import { httpBasic, routeAuth } from "eve/channels/auth";
import { z } from "zod";
import { readBody } from "../../../../server/request-body.ts";
import { createSearchQueryEncoder, searchQuerySchema } from "../../../../server/search-query.ts";
import { createNoteEmbedder } from "../../embeddings.ts";

const inputSchema = z.strictObject({ query: searchQuerySchema });
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export function createNoteSearchChannel(
  encodeQuery: (query: string) => Promise<number[]> = (query) =>
    createSearchQueryEncoder(createNoteEmbedder({ apiKey: process.env.OPENROUTER_API_KEY ?? "" }))(
      query,
    ),
) {
  return defineChannel({
    routes: [
      POST("/internal/note-search/embed", async (request) => {
        const token = process.env.ORGANIZER_SERVICE_TOKEN;
        if (!token || token.length < 32) return json({ error: "Unavailable" }, 503);
        const auth = await routeAuth(request, httpBasic({ username: "api", password: token }));
        if (auth instanceof Response) return auth;
        try {
          const raw = await readBody(request, 4096);
          if (raw === undefined) return json({ error: "Invalid request" }, 400);
          let input: unknown;
          try {
            input = JSON.parse(raw);
          } catch {
            return json({ error: "Invalid request" }, 400);
          }
          const parsed = inputSchema.safeParse(input);
          if (!parsed.success) return json({ error: "Invalid request" }, 400);
          return json({ embedding: await encodeQuery(parsed.data.query) });
        } catch {
          return json({ error: "Unavailable" }, 503);
        }
      }),
    ],
  });
}

export default createNoteSearchChannel();
