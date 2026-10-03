/**
 * Supabase client for the TICKR social layer.
 *
 * Uses the SERVICE ROLE key (server-side only — never expose to the browser).
 * All social tables have RLS enabled with no public policies, so only this
 * client can read/write them.
 *
 * The backend boots fine WITHOUT Supabase configured: createSocialDb()
 * returns null, the social indexer stays off, and /api/social/* answers 503.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";
import { logger } from "./logger.js";

export function createSocialDb(): SupabaseClient | null {
  const url = config.social.supabaseUrl;
  const key = config.social.supabaseServiceRoleKey;
  if (!url || !key) {
    logger.warn(
      "[social] Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) — social layer disabled"
    );
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
