/**
 * Shared helpers for the /api/social Route Handlers.
 * (Underscore-prefixed so Next.js doesn't treat it as a route.)
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseServer";
import { currentSeasonId } from "@/lib/seasonServer";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";

/** Returns { db } or { response } (503 when Supabase isn't configured). */
export function dbOr503(): { db: SupabaseClient } | { response: Response } {
  const db = getSupabase();
  if (!db) return { response: Response.json({ error: "social_disabled" }, { status: 503 }) };
  return { db };
}

export interface ProfileDto {
  walletAddress: string;
  username: string;
  favouriteTeamId: number;
  bio: string;
  stats: {
    marketsBacked: number;
    openMarkets: number;
    resolvedMarkets: number;
    voidedMarkets: number;
    marketsCreated: number;
  };
  seasonId: number;
}

interface ProfileRow {
  wallet_address: string;
  username: string;
  username_set_season: number;
  favourite_team_id: number;
  favourite_team_set_season: number;
  bio: string;
}

/**
 * Public profile DTO + raw row for a wallet address (lowercase). Null when
 * the wallet has no profile. Counts come from indexed market rows in the
 * current season, so repeated
 * stakes in one market count as one backed market. Financial data stays in
 * the owner-only analytics endpoint.
 */
export async function profileWithStats(
  db: SupabaseClient,
  walletAddress: string
): Promise<{ dto: ProfileDto; row: ProfileRow } | null> {
  const wallet = walletAddress.toLowerCase();
  const season = await currentSeasonId();

  const { data: p, error: profileError } = await db
    .from("profiles")
    .select(
      "wallet_address, username, username_set_season, favourite_team_id, favourite_team_set_season, bio"
    )
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (profileError) throw new Error(`profile query failed: ${profileError.message}`);
  if (!p) return null;
  const row = p as ProfileRow;

  const states = new Map<string, string>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db.from("stakes")
      .select("market_id, markets!inner(state)")
      .eq("chain_id", ACTIVE_CHAIN_ID)
      .eq("season_id", season)
      .eq("staker", wallet)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`profile stakes query failed: ${error.message}`);
    const rows = (data ?? []) as unknown as Array<{ market_id: number | string; markets: { state: string } }>;
    for (const stake of rows) states.set(String(stake.market_id), stake.markets.state);
    if (rows.length < pageSize) break;
  }
  const { count: marketsCreated, error: marketsError } = await db.from("markets")
    .select("market_id", { count: "exact", head: true })
    .eq("chain_id", ACTIVE_CHAIN_ID)
    .eq("season_id", season)
    .eq("creator", wallet);
  if (marketsError) throw new Error(`profile markets query failed: ${marketsError.message}`);
  const stateValues = [...states.values()];

  return {
    dto: {
      walletAddress: row.wallet_address,
      username: row.username,
      favouriteTeamId: row.favourite_team_id,
      bio: row.bio ?? "",
      stats: {
        marketsBacked: states.size,
        openMarkets: stateValues.filter((state) => state === "open").length,
        resolvedMarkets: stateValues.filter((state) => state === "resolved").length,
        voidedMarkets: stateValues.filter((state) => state === "voided").length,
        marketsCreated: marketsCreated ?? 0,
      },
      seasonId: season,
    },
    row,
  };
}
