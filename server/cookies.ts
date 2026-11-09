/** Base name. Write and read the session cookie through sessionCookieName instead. */
export const SESSION_COOKIE_NAME = "atlas_session";
export const LOGIN_TRANSACTION_COOKIE_NAME = "atlas_login_transaction";

/**
 * HTTPS origins use the __Host- prefix, so the browser rejects the cookie unless it is
 * Secure, has Path=/ and has no Domain. Loopback HTTP cannot set the prefix.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? `__Host-${SESSION_COOKIE_NAME}` : SESSION_COOKIE_NAME;
}

export type CookieSettings = Readonly<{
  path: string;
  secure: boolean;
  sameSite?: "Lax" | "Strict";
}>;

export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function serializeCookie(
  name: string,
  value: string,
  settings: CookieSettings,
  maxAgeSeconds?: number,
): string {
  const parts = [`${name}=${value}`, `Path=${settings.path}`];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  parts.push("HttpOnly", `SameSite=${settings.sameSite ?? "Lax"}`);
  if (settings.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, settings: CookieSettings): string {
  return serializeCookie(name, "", settings, 0);
}
