import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vite-plus/test";

const root = fileURLToPath(new URL("../", import.meta.url));

async function launch(args: string[], environment: Record<string, string>) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...environment, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const deadline = setTimeout(() => child.kill("SIGKILL"), 6_000);
      await exited;
      clearTimeout(deadline);
    }
  });
  return await new Promise<string>((resolve, reject) => {
    let output = "";
    const deadline = setTimeout(() => reject(new Error("Server did not become ready.")), 15_000);
    child.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Server exited before readiness (${code}): ${output}`));
    });
    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(deadline);
        resolve(match[0]);
      }
    });
  });
}

it("serves health and denies protected requests through the real Node entrypoint", async () => {
  const url = await launch(["server/index.ts"], { API_PORT: "0" });
  const health = await fetch(`${url}/api/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const protectedResponse = await fetch(`${url}/api/notes`, {
    headers: { "X-User-Id": "forged" },
  });
  expect(protectedResponse.status).toBe(401);
  expect(await protectedResponse.json()).toEqual({
    error: { code: "UNAUTHENTICATED", message: "Sign in to access notes." },
  });
});

it("fails startup on invalid configuration without exposing it", async () => {
  const child = spawn(process.execPath, ["server/index.ts"], {
    cwd: root,
    env: { ...process.env, API_PORT: "SYNTHETIC_SECRET" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stderr.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const [code] = await once(child, "exit");
  expect(code).toBe(1);
  expect(output).toContain("API_PORT must be an integer");
  expect(output).not.toContain("SYNTHETIC_SECRET");
  expect(output).not.toContain("listening");
});

it("forwards the same-origin API path through the actual Vite development config", async () => {
  const api = await launch(["server/index.ts"], { API_PORT: "0" });
  const web = await launch(
    ["node_modules/vite-plus/bin/vp", "dev", "--host", "127.0.0.1", "--port", "0", "--strictPort"],
    { API_PORT: new URL(api).port },
  );
  const health = await fetch(`${web}/api/health`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  const notes = await fetch(`${web}/api/notes`);
  expect(notes.status).toBe(401);
  expect(notes.headers.get("Content-Type")).toContain("application/json");
}, 30_000);
