import { hasEmptyBody } from "./request-body.ts";
import { Hono } from "hono";
import { z } from "zod";
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
  Partial<Pick<ReturnType<typeof createDurableOrganizeRuns>, "drafts" | "work" | "handoff">>;

const idSchema = z.uuid();
const notFound = () => apiError("NOT_FOUND", "Resource not found.");
const unavailable = () => apiError("SERVICE_UNAVAILABLE", "Organizer is temporarily unavailable.");

/** Mounted behind requireAuth and the app's cookie-origin protection. */
export function createOrganizeRoutes(service?: OrganizeService) {
  const routes = new Hono<AuthEnv>();
  routes.route("/", createDraftRoutes(service));

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
      const expected = c.req.header("If-Match");
      if (expected === undefined)
        return c.json(apiError("PRECONDITION_REQUIRED", "If-Match is required."), 428);
      if (!ifMatchSchema.safeParse(expected).success)
        return c.json(apiError("VALIDATION_ERROR", "Invalid If-Match."), 400);
      const result = await service.start(c.get("user").userId, id.data, expected);
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
        return c.json(
          apiError("CONFLICT", "Finish the existing draft or run before organizing again."),
          409,
        );
      }
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
