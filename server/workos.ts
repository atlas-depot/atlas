import type { WorkOS } from "@workos-inc/node";
import type { AuthenticateRequest } from "./auth.ts";

/** Verifies access tokens offline; session revocation takes effect at token expiry. */
export function createBearerAuthenticator(workos: WorkOS): AuthenticateRequest {
  return async (request) => {
    const authorization = request.headers.get("Authorization");
    const token = authorization?.match(/^Bearer +([A-Za-z0-9._~+/-]+=*)$/i)?.[1];
    if (!token) return null;
    const claims = await workos.userManagement.verifyAccessToken(token);
    return claims?.sub ? { userId: claims.sub } : null;
  };
}
