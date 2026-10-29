import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";
const AAD = Buffer.from("atlas-login-transaction:v1", "utf8");

export type LoginTransaction = Readonly<{
  state: string;
  codeVerifier: string;
  expiresAt: number;
}>;

function isLoginTransaction(value: unknown): value is LoginTransaction {
  if (!value || typeof value !== "object") return false;
  const transaction = value as Record<string, unknown>;
  return (
    typeof transaction.state === "string" &&
    transaction.state.length > 0 &&
    typeof transaction.codeVerifier === "string" &&
    transaction.codeVerifier.length > 0 &&
    typeof transaction.expiresAt === "number" &&
    Number.isFinite(transaction.expiresAt)
  );
}

/**
 * Encrypts the short-lived PKCE state with a key derived from the WorkOS cookie
 * password. The browser cannot read or modify it; the callback only accepts it
 * when the state, authentication tag and expiry all match.
 */
export function createTransactionSealer(password: string) {
  const key = scryptSync(password, "atlas-login-transaction", 32);

  return {
    seal(transaction: LoginTransaction): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(transaction), "utf8"),
        cipher.final(),
      ]);
      return [
        VERSION,
        iv.toString("base64url"),
        ciphertext.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(".");
    },

    unseal(value: string | undefined, now = Date.now()): LoginTransaction | null {
      if (!value) return null;
      const [version, iv, ciphertext, tag, ...extra] = value.split(".");
      if (version !== VERSION || !iv || !ciphertext || !tag || extra.length > 0) return null;
      try {
        const ivBytes = Buffer.from(iv, "base64url");
        const tagBytes = Buffer.from(tag, "base64url");
        if (ivBytes.length !== 12 || tagBytes.length !== 16) return null;
        const decipher = createDecipheriv("aes-256-gcm", key, ivBytes);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tagBytes);
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        const parsed: unknown = JSON.parse(plaintext);
        if (!isLoginTransaction(parsed) || parsed.expiresAt <= now) return null;
        return parsed;
      } catch {
        return null;
      }
    },
  };
}
