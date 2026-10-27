import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readServerEnv } from "./env.ts";

try {
  const { port } = readServerEnv(process.env);
  const app = createApp();
  const server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port, overrideGlobalObjects: false },
    (address) => console.log(`Atlas API listening on http://127.0.0.1:${address.port}`),
  );
  server.on("error", () => {
    console.error("Atlas API could not start. Check API_PORT and port availability.");
    process.exitCode = 1;
  });
  const shutdown = () => {
    const deadline = setTimeout(() => process.exit(1), 5_000);
    deadline.unref();
    server.close((error) => {
      clearTimeout(deadline);
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch {
  console.error("Atlas API could not start. API_PORT must be an integer from 0 to 65535.");
  process.exitCode = 1;
}
