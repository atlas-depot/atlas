import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { readServerEnv } from "./env.ts";

function main() {
  let port: number;
  try {
    ({ port } = readServerEnv(process.env));
  } catch {
    console.error("Atlas API could not start. API_PORT must be an integer from 0 to 65535.");
    process.exitCode = 1;
    return;
  }
  // TODO: Connect WorkOS authentication; the server currently rejects every private request.
  const app = createApp(async () => null);
  const server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port, overrideGlobalObjects: false },
    (address) => console.log(`Atlas API listening on http://127.0.0.1:${address.port}`),
  );
  server.on("error", () => {
    console.error("Atlas API could not start. Check API_PORT and port availability.");
    process.exitCode = 1;
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => process.exit(1), 5_000);
    deadline.unref();
    server.close((error) => {
      clearTimeout(deadline);
      process.exitCode = error ? 1 : 0;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main();
