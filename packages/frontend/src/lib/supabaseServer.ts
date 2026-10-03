/**
 * Server-only Supabase client for the social-layer Route Handlers.
 * Uses the SERVICE ROLE key (bypasses RLS) — never import from client components.
 */

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let warned = false;

/**
 * Service-role client, or null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * are missing. Route handlers degrade to 503 instead of crashing the app.
 */
export function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!warned) {
      warned = true;
      console.warn(
        "[social] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — social endpoints disabled."
      );
    }
    return null;
  }
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
