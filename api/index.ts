import { readServerEnv } from "../server/env.ts";
import { apiError } from "../shared/http.ts";
import { createServerRuntime } from "../server/index.ts";

async function start() {
  let config: ReturnType<typeof readServerEnv>;
  try {
    config = readServerEnv(process.env);
    if (!config.browserAuth || !config.databaseUrl || !config.organizer)
      throw new Error("Incomplete hosted configuration.");
  } catch (error) {
    console.error("atlas_api_startup_failed: configuration");
    throw error;
  }
  try {
    return await createServerRuntime(config);
  } catch (error) {
    const missingModule =
      error instanceof Error &&
      "code" in error &&
      (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND");
    console.error(
      missingModule
        ? "atlas_api_startup_failed: missing_module"
        : "atlas_api_startup_failed: runtime",
    );
    throw error;
  }
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
