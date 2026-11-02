import { Hono } from "hono";
import { z } from "zod";
import { apiError } from "../shared/http.ts";
import { organizeRunResponseSchema, organizeStartResponseSchema } from "../shared/organize.ts";
import type { AuthEnv } from "./auth.ts";
import type { createDurableOrganizeRuns } from "./organize-runs.ts";

export type OrganizeService = Pick<
  ReturnType<typeof createDurableOrganizeRuns>,
  "start" | "read" | "cancel" | "acknowledge"
>;

const idSchema = z.uuid();
const notFound = () => apiError("NOT_FOUND", "Resource not found.");
const unavailable = () => apiError("SERVICE_UNAVAILABLE", "Organizer is temporarily unavailable.");

async function hasEmptyBody(request: Request): Promise<boolean> {
  if (Number(request.headers.get("Content-Length")) > 0) return false;
  if (!request.body) return true;
  const reader = request.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // Node presents even bodyless POSTs as streams. Inspect without collecting bytes,
    // and bound empty/stalled uploads before any database or runtime work begins.
    return await Promise.race([
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return true;
          if (value.byteLength > 0) return false;
        }
      })(),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), 5_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    // Cancellation must not make a stalled uploader block the response again.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Mounted behind requireAuth and the app's cookie-origin protection. */
export function createOrganizeRoutes(service?: OrganizeService) {
  const routes = new Hono<AuthEnv>();

  routes.post("/notes/:id/organize", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success || !(await hasEmptyBody(c.req.raw))) {
      return c.json(
        apiError("VALIDATION_ERROR", "A valid ID and an empty request body are required."),
        400,
      );
    }
    if (!service) return c.json(unavailable(), 503);
    try {
      const result = await service.start(c.get("user").userId, id.data);
      if (result.status === "not_found") return c.json(notFound(), 404);
      const response = organizeStartResponseSchema.parse({
        runId: result.runId,
        status: result.status ?? "accepted",
      });
      return c.json(response, 202);
    } catch {
      return c.json(unavailable(), 503);
    }
  });

  for (const action of ["read", "cancel", "acknowledge"] as const) {
    const path = `/organize-runs/:id${action === "read" ? "" : `/${action}`}`;
    routes.on(action === "read" ? "GET" : "POST", path, async (c) => {
      const id = idSchema.safeParse(c.req.param("id"));
      if (!id.success || !(await hasEmptyBody(c.req.raw))) {
        return c.json(
          apiError("VALIDATION_ERROR", "A valid ID and an empty request body are required."),
          400,
        );
      }
      if (!service) return c.json(unavailable(), 503);
      try {
        const result = await service[action](c.get("user").userId, id.data);
        if (result.status === "not_found") return c.json(notFound(), 404);
        const response = organizeRunResponseSchema.parse({ ...result, runId: id.data });
        if (action === "acknowledge" && response.status === "running") {
          return c.json(
            apiError("CONFLICT", "The organizer draft is not ready to acknowledge."),
            409,
          );
        }
        const pending =
          response.status === "cleaning" ||
          (response.status === "failed" && response.reason === "cleanup_failed");
        return c.json(response, action !== "read" && pending ? 202 : 200);
      } catch {
        return c.json(unavailable(), 503);
      }
    });
  }

  return routes;
}
