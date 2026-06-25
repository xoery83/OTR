import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const algorithm = "aes-256-gcm";

function getKey() {
  const secret =
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.GOOGLE_CLIENT_SECRET;

  if (!secret) {
    throw new Error(
      "Missing GOOGLE_TOKEN_ENCRYPTION_KEY or GOOGLE_CLIENT_SECRET.",
    );
  }

  return createHash("sha256").update(secret).digest();
}

export function encryptGoogleToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, getKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptGoogleToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");

  if (version !== "v1" || !iv || !tag || !encrypted) {
    throw new Error("Invalid encrypted Google token.");
  }

  const decipher = createDecipheriv(
    algorithm,
    getKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
