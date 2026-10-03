/**
 * Shared helpers for the /api/social Route Handlers.
 * (Underscore-prefixed so Next.js doesn't treat it as a route.)
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabaseServer";
import { currentSeasonId } from "@/lib/seasonServer";

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
    predictions: number;
    settled: number;
    wins: number;
    winRateBps: number;
    pnlTick: string;
    rank: number | null;
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
 * the wallet has no profile. Stats come from user_season_stats for the
 * current season; rank is the dense PnL rank within that season.
 */
export async function profileWithStats(
  db: SupabaseClient,
  walletAddress: string
): Promise<{ dto: ProfileDto; row: ProfileRow } | null> {
  const wallet = walletAddress.toLowerCase();
  const season = await currentSeasonId();

  const { data: p } = await db
    .from("profiles")
    .select(
      "wallet_address, username, username_set_season, favourite_team_id, favourite_team_set_season, bio"
    )
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (!p) return null;
  const row = p as ProfileRow;

  const { data: s } = await db
    .from("user_season_stats")
    .select("predictions, settled, wins, pnl_tick")
    .eq("wallet_address", wallet)
    .eq("season_id", season)
    .maybeSingle();

  let rank: number | null = null;
  if (s) {
    const { count } = await db
      .from("user_season_stats")
      .select("wallet_address", { count: "exact", head: true })
      .eq("season_id", season)
      .gt("pnl_tick", String(s.pnl_tick ?? "0"));
    rank = (count ?? 0) + 1;
  }

  const settled = Number(s?.settled ?? 0);
  const wins = Number(s?.wins ?? 0);

  return {
    dto: {
      walletAddress: row.wallet_address,
      username: row.username,
      favouriteTeamId: row.favourite_team_id,
      bio: row.bio ?? "",
      stats: {
        predictions: Number(s?.predictions ?? 0),
        settled,
        wins,
        winRateBps: settled > 0 ? Math.round((wins / settled) * 10000) : 0,
        pnlTick: String(s?.pnl_tick ?? "0"),
        rank,
      },
      seasonId: season,
    },
    row,
  };
}
