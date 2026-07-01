import "server-only";

import { createClient } from "@supabase/supabase-js";
import { PromptCenterError, type PromptCenterSupabase } from "./types";

export function getPromptCenterSupabase(): PromptCenterSupabase {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const key = serviceRoleKey || anonKey;

  if (!supabaseUrl || !key) {
    throw new PromptCenterError("Missing Supabase environment variables.");
  }

  return createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

