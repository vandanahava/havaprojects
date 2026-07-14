import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for Plaid access tokens at rest.
 * Key comes from TOKEN_ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 * Ciphertext format: base64(iv):base64(authTag):base64(data)
 */

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be set to a 64-char hex string (32 bytes). See .env.example."
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = ciphertext.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
