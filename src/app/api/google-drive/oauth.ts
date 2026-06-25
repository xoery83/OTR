import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export type GoogleDriveOAuthState = {
  tripId: string;
  userId: string;
  nonce: string;
  exp: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getStateSecret() {
  const secret =
    process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.GOOGLE_CLIENT_SECRET;

  if (!secret) {
    throw new Error("Missing GOOGLE_OAUTH_STATE_SECRET or GOOGLE_CLIENT_SECRET.");
  }

  return secret;
}

export function getGoogleClientConfig(origin: string) {
  const clientId =
    process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.");
  }

  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/google-drive/callback`,
  };
}

export function createGoogleDriveState(input: {
  tripId: string;
  userId: string;
}) {
  const payload: GoogleDriveOAuthState = {
    tripId: input.tripId,
    userId: input.userId,
    nonce: randomBytes(16).toString("hex"),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", getStateSecret())
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifyGoogleDriveState(state: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Invalid Google Drive state.");
  }

  const expected = createHmac("sha256", getStateSecret())
    .update(encodedPayload)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid Google Drive state signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as GoogleDriveOAuthState;

  if (!payload.tripId || !payload.userId || payload.exp < Date.now()) {
    throw new Error("Expired Google Drive state.");
  }

  return payload;
}

export function createGoogleDriveAuthUrl(input: {
  origin: string;
  tripId: string;
  userId: string;
}) {
  const { clientId, redirectUri } = getGoogleClientConfig(input.origin);
  const state = createGoogleDriveState({
    tripId: input.tripId,
    userId: input.userId,
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}
