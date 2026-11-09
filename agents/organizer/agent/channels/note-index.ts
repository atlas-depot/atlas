import { defineChannel, GET, POST } from "eve/channels";
import { httpBasic, routeAuth } from "eve/channels/auth";
import { getRun } from "eve/workflow/api";
import { z } from "zod";
import { indexRunStatusSchema } from "../../../../shared/index-jobs.ts";
import { noteIdSchema } from "../../../../shared/notes.ts";
import { indexRunIdSchema } from "../../index-client.ts";
import { createIndexRuntime } from "../../index-runtime.ts";

const inputSchema = z.strictObject({ noteId: noteIdSchema });
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
async function authorize(request: Request) {
  const token = process.env.ORGANIZER_SERVICE_TOKEN;
  if (!token || token.length < 32) return json({ error: "Unavailable" }, 503);
  return routeAuth(request, httpBasic({ username: "atlas-api", password: token }));
}

export default defineChannel({
  routes: [
    POST("/internal/note-index/start", async (request) => {
      try {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;
        // The caller sends only an identifier. Reject large or malformed bodies.
        const raw = await request.text();
        if (raw.length > 256) return json({ error: "Invalid request" }, 400);
        let input: unknown;
        try {
          input = JSON.parse(raw);
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) return json({ error: "Invalid request" }, 400);
        const runtime = createIndexRuntime();
        try {
          return json(await runtime.start(parsed.data.noteId), 202);
        } finally {
          await runtime.close();
        }
      } catch {
        return json({ error: "Unavailable" }, 503);
      }
    }),
    GET("/internal/note-index/runs/:runId", async (request, { params }) => {
      try {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;
        const id = indexRunIdSchema.safeParse(params.runId);
        if (!id.success) return json({ error: "Invalid request" }, 400);
        const status = indexRunStatusSchema.parse(await getRun(id.data).status);
        return json({ runId: id.data, status });
      } catch {
        return json({ error: "Unavailable" }, 503);
      }
    }),
  ],
});
