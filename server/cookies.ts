export const SESSION_COOKIE_NAME = "atlas_session";
export const LOGIN_TRANSACTION_COOKIE_NAME = "atlas_login_transaction";

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
