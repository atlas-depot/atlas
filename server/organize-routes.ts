import type { NoteSaved } from "./note-index-routes.ts";
import { hasEmptyBody, readJson } from "./request-body.ts";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { organizeInputSchema, type OrganizeInput } from "../shared/organize-input.ts";
import { apiError, ifMatchSchema } from "../shared/http.ts";
import { organizeRunResponseSchema, organizeStartResponseSchema } from "../shared/organize.ts";
import { OrganizeClaimError } from "./db/organize-runs.ts";
import { createDraftRoutes } from "./draft-routes.ts";
import type { AuthEnv } from "./auth.ts";
import { reportStorageFailure } from "./http-errors.ts";
import type { createDurableOrganizeRuns } from "./organize-runs.ts";

export type OrganizeService = Pick<
  ReturnType<typeof createDurableOrganizeRuns>,
  "start" | "read" | "cancel" | "acknowledge"
> &
  Partial<
    Pick<
      ReturnType<typeof createDurableOrganizeRuns>,
      "drafts" | "work" | "handoff" | "recover" | "listRecoverable"
    >
  >;

const idSchema = z.uuid();
const notFound = () => apiError("NOT_FOUND", "Resource not found.");
const unavailable = () => apiError("SERVICE_UNAVAILABLE", "Organizer is temporarily unavailable.");

/** Mounted behind requireAuth and the app's cookie-origin protection. */
export function createOrganizeRoutes(service?: OrganizeService, onSaved?: NoteSaved) {
  const routes = new Hono<AuthEnv>();
  routes.route("/", createDraftRoutes(service, onSaved));

  async function start(c: Context<AuthEnv>, input: string | { key: string; input: OrganizeInput }) {
    if (!service) return c.json(unavailable(), 503);
    try {
      const expected = c.req.header("If-Match");
      const needsRevision = typeof input === "string" || input.input.kind === "note";
      if (needsRevision && expected === undefined)
        return c.json(apiError("PRECONDITION_REQUIRED", "If-Match is required."), 428);
      if (expected !== undefined && (!needsRevision || !ifMatchSchema.safeParse(expected).success))
        return c.json(apiError("VALIDATION_ERROR", "Invalid If-Match."), 400);
      const result = await service.start(c.get("user").userId, input, expected);
      if (result.status === "not_found") return c.json(notFound(), 404);
      const response = organizeStartResponseSchema.parse({
        runId: result.runId,
        status: result.status ?? "accepted",
      });
      return c.json(response, 202);
    } catch (error) {
      if (error instanceof OrganizeClaimError) {
        if (error.reason === "stale")
          return c.json(
            apiError(
              "PRECONDITION_FAILED",
              "The source note changed. Save or reload before organizing.",
            ),
            412,
          );
        if (error.reason === "limit")
          return c.json(
            apiError(
              "RATE_LIMITED",
              "Too many organize runs are in progress. Finish or cancel one, then try again.",
            ),
            429,
          );
        if (error.reason === "key_conflict")
          return c.json(apiError("CONFLICT", "This operation key cannot start a new run."), 409);
        return c.json(
          apiError("CONFLICT", "Finish the existing draft or run before organizing again."),
          409,
        );
      }
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  }

  routes.post("/notes/:id/organize", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success || !(await hasEmptyBody(c.req.raw))) {
      return c.json(
        apiError("VALIDATION_ERROR", "A valid ID and an empty request body are required."),
        400,
      );
    }
    return start(c, id.data);
  });

  routes.post("/organize-runs", async (c) => {
    const key = idSchema.safeParse(c.req.header("Idempotency-Key"));
    const input = organizeInputSchema.safeParse(await readJson(c.req.raw));
    if (!key.success || !input.success)
      return c.json(
        apiError("VALIDATION_ERROR", "A valid operation key and organizer input are required."),
        400,
      );
    return start(c, { key: key.data, input: input.data });
  });

  routes.get("/organize-requests", async (c) => {
    if (!service?.listRecoverable) return c.json(unavailable(), 503);
    try {
      const requests = await service.listRecoverable(c.get("user").userId);
      return c.json({ requests });
    } catch (error) {
      reportStorageFailure(c, error);
      return c.json(unavailable(), 503);
    }
  });
  routes.get("/organize-requests/:id", async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    if (!id.success) return c.json(apiError("VALIDATION_ERROR", "A valid ID is required."), 400);
    if (!service?.recover) return c.json(unavailable(), 503);
    try {
      const record = await service.recover(c.get("user").userId, id.data);
      return record ? c.json(record) : c.json(notFound(), 404);
    } catch (error) {
      reportStorageFailure(c, error);
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
        if (
          response.status === "draft" &&
          response.source &&
          c.req.query("include") !== "original"
        ) {
          const { markdown, sources } = response.draft;
          return c.json({ ...response, draft: { markdown, sources } });
        }
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
      } catch (error) {
        reportStorageFailure(c, error);
        return c.json(unavailable(), 503);
      }
    });
  }

  return routes;
}
