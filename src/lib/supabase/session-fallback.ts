import type { Session } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase/client";

const SESSION_STORAGE_KEY = "otr_auth_session_v1";
const SESSION_COOKIE_NAME = "otr_auth_session_v1";
const SESSION_PERSIST_DAYS = 30;

type PersistedSession = Pick<Session, "access_token" | "refresh_token" | "expires_at">;

function isClient() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getCookie(name: string): string | null {
  if (!isClient()) {
    return null;
  }

  const cookie = `; ${document.cookie}`;
  const parts = cookie.split(`; ${name}=`);
  if (parts.length !== 2) {
    return null;
  }

  return decodeURIComponent(parts.pop()?.split(";")[0] ?? "");
}

function setCookie(name: string, value: string, maxAgeDays: number) {
  if (!isClient()) {
    return;
  }

  const isHttps = window.location.protocol === "https:";
  const maxAge = Math.floor(maxAgeDays * 24 * 60 * 60);
  const secure = isHttps ? " Secure;" : "";
  document.cookie = `${name}=${encodeURIComponent(
    value,
  )}; Max-Age=${maxAge}; Path=/; SameSite=Lax;${secure}`;
}

function deleteCookie(name: string) {
  if (!isClient()) {
    return;
  }

  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax;`;
}

function readStorage(): PersistedSession | null {
  if (!isClient()) {
    return null;
  }

  try {
    const raw =
      window.localStorage.getItem(SESSION_STORAGE_KEY) ??
      getCookie(SESSION_COOKIE_NAME);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedSession;
    if (
      !parsed.access_token ||
      !parsed.refresh_token ||
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(session: PersistedSession) {
  if (!isClient()) {
    return;
  }

  const serialized = JSON.stringify(session);
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, serialized);
  } catch {
    // localStorage can be unavailable in some privacy modes.
  }

  setCookie(SESSION_COOKIE_NAME, serialized, SESSION_PERSIST_DAYS);
}

function removeStorage() {
  if (!isClient()) {
    return;
  }

  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore.
  }
  deleteCookie(SESSION_COOKIE_NAME);
}

export function clearAuthSessionPersistence() {
  removeStorage();
}

type PersistableSession = Pick<Session, "access_token" | "refresh_token"> & {
  expires_at?: number | null;
};

export function persistAuthSession(session: (Session | PersistableSession | null) & {
  access_token?: string | null;
  refresh_token?: string | null;
}) {
  if (!session?.access_token || !session?.refresh_token) {
    return;
  }

  writeStorage({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
  });
}

export async function restoreAuthSessionFromStorage(): Promise<boolean> {
  if (!isClient()) {
    return false;
  }

  const cached = readStorage();
  if (!cached) {
    return false;
  }

  const { error } = await supabase.auth.setSession({
    access_token: cached.access_token,
    refresh_token: cached.refresh_token,
  });
  if (error) {
    clearAuthSessionPersistence();
    return false;
  }

  return true;
}

export async function ensureRestoredSession() {
  const existing = await supabase.auth.getSession();
  if (existing.data.session?.user) {
    return existing.data.session;
  }

  const cached = readStorage();
  if (!cached) {
    clearAuthSessionPersistence();
    return null;
  }

  const restored = await restoreAuthSessionFromStorage();
  if (!restored) {
    return null;
  }

  const next = await supabase.auth.getSession();
  return next.data.session;
}
