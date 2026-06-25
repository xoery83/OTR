import type { User } from "@supabase/supabase-js";
import { getAppOrigin } from "@/lib/app-url";
import { supabase } from "./client";

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  return data.user;
}

export async function signInWithGoogle(nextPath?: string | null) {
  const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  const redirectTo = `${getAppOrigin()}/auth/callback${next}`;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });

  if (error) {
    throw error;
  }
}

export async function connectGoogleDriveStorage(nextPath: string) {
  const redirectTo = `${getAppOrigin()}/auth/callback?next=${encodeURIComponent(
    nextPath,
  )}`;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.file",
      ].join(" "),
      queryParams: {
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      },
    },
  });

  if (error) {
    throw error;
  }
}

export async function signInWithEmailOtp(email: string, nextPath?: string | null) {
  const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  const redirectTo = `${getAppOrigin()}/auth/callback${next}`;

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    throw error;
  }
}

export async function exchangeCodeForSession(code: string) {
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    throw error;
  }

  return data.session;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

export function getUserDisplayName(user: User) {
  return (
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email ||
    "OTR traveler"
  );
}

export function getUserAvatarUrl(user: User) {
  return (
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    null
  );
}
