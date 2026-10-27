import { serve } from "@hono/node-server";
import { WorkOS } from "@workos-inc/node";
import { createApp } from "./app.ts";
import { readServerEnv } from "./env.ts";
import { createBearerAuthenticator } from "./workos.ts";

function main() {
  let configuration: ReturnType<typeof readServerEnv>;
  try {
    configuration = readServerEnv(process.env);
  } catch {
    console.error("Atlas API could not start. Check API_PORT and WorkOS configuration.");
    process.exitCode = 1;
    return;
  }
  const { port, workos } = configuration;
  const app = createApp(workos ? createBearerAuthenticator(new WorkOS(workos)) : async () => null);
  const server = serve(
    { fetch: app.fetch, hostname: "127.0.0.1", port, overrideGlobalObjects: false },
    (address) => console.log(`Atlas API listening on http://127.0.0.1:${address.port}`),
  );
  server.on("error", () => {
    if (server.listening) {
      console.error("Atlas API server error.");
    } else {
      console.error("Atlas API could not start. Check API_PORT and port availability.");
      process.exitCode = 1;
    }
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
