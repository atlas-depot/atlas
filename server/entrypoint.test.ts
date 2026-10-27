import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createServer } from "vite-plus";
import { expect, it, onTestFinished, vi } from "vite-plus/test";

const root = fileURLToPath(new URL("../", import.meta.url));

async function startApi() {
  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: root,
    env: { ...process.env, API_PORT: "0", WORKOS_CLIENT_ID: undefined, WORKOS_ISSUER: undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onTestFinished(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, "close");
    child.kill("SIGTERM");
    const deadline = setTimeout(() => child.kill("SIGKILL"), 2_000);
    await closed;
    clearTimeout(deadline);
  });
  return new Promise<string>((resolve, reject) => {
    let output = "";
    const deadline = setTimeout(() => reject(new Error("API startup timed out.")), 5_000);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(deadline);
      reject(new Error("API exited before readiness."));
    });
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {
        clearTimeout(deadline);
        resolve(url);
      }
    });
  });
}

it("serves health and protects API routes through the real Node entrypoint and Vite proxy", async () => {
  const api = await startApi();
  vi.stubEnv("API_PORT", new URL(api).port);
  vi.stubEnv("VITEST", "");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_fixture");
  vi.stubEnv("WORKOS_ISSUER", "");
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const web = await createServer({
    root,
    configFile: `${root}vite.config.ts`,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  onTestFinished(() => web.close());
  await web.listen();
  const address = web.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Missing Vite port.");
  const url = `http://127.0.0.1:${address.port}`;
  for (const origin of [api, url]) {
    const health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3_000) });
    expect(await health.json()).toEqual({ status: "ok" });
  }
  for (const path of ["/api/notes", "/api?probe=1"]) {
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(3_000) });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="atlas"');
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  }
}, 20_000);

it("rejects invalid startup configuration with safe diagnostics", async () => {
  const result: unknown = await promisify(execFile)(process.execPath, ["server/index.ts"], {
    cwd: root,
    env: { ...process.env, API_PORT: "SYNTHETIC_SECRET" },
    timeout: 3_000,
  }).catch((error: unknown) => error);
  expect(result).toMatchObject({
    code: 1,
    stdout: "",
    stderr: expect.stringContaining("API_PORT"),
  });
  expect(result).toMatchObject({ stderr: expect.not.stringContaining("SYNTHETIC_SECRET") });
});

it("builds the frontend even when backend port configuration is invalid", async () => {
  const output = await mkdtemp(join(tmpdir(), "atlas-build-"));
  onTestFinished(() => rm(output, { recursive: true, force: true }));
  await promisify(execFile)(
    process.execPath,
    ["node_modules/vite-plus/bin/vp", "build", "--outDir", output],
    { cwd: root, env: { ...process.env, API_PORT: "invalid", VITEST: "" }, timeout: 20_000 },
  );
  expect(await readFile(join(output, "index.html"), "utf8")).toContain('type="module"');
}, 30_000);
