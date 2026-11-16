import { readServerEnv } from "../server/env.ts";
import { apiError } from "../shared/http.ts";
import { createServerRuntime } from "../server/index.ts";

async function start() {
  const config = readServerEnv(process.env);
  if (!config.browserAuth || !config.databaseUrl || !config.organizer)
    throw new Error(
      "Hosted Atlas requires browser authentication, database and organizer settings.",
    );
  return createServerRuntime(config);
}

let runtime: ReturnType<typeof start> | undefined;
export default {
  async fetch(request: Request) {
    runtime ??= start().catch((error: unknown) => {
      runtime = undefined;
      throw error;
    });
    try {
      const { app } = await runtime;
      return app.fetch(request);
    } catch {
      return Response.json(apiError("SERVICE_UNAVAILABLE", "Atlas API is unavailable."), {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
