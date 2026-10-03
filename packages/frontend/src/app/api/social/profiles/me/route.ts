/**
 * /api/social/profiles/me — the caller's own profile (Privy-authenticated).
 *
 * GET  ?walletAddress=0x… → full profile + season edit permissions.
 * PUT  { walletAddress, username?, favouriteTeamId?, bio? } → claim or update.
 *
 * Season rules (FPL-style): username and favourite team can each be changed
 * only when their *_set_season is older than the current on-chain season.
 * First claim (no row yet) requires username + team and is always allowed.
 */

import { dbOr503, profileWithStats } from "../../_shared";
import { requireLinkedWallet } from "@/lib/privyServer";
import { currentSeasonId } from "@/lib/seasonServer";

export const dynamic = "force-dynamic"; // private: never cache authed responses
export const runtime = "nodejs";

function editFlags(usernameSetSeason: number, teamSetSeason: number, season: number) {
  const canEditUsername = usernameSetSeason < season;
  const canEditTeam = teamSetSeason < season;
  return {
    canEditUsername,
    canEditTeam,
    usernameLockedUntil: canEditUsername ? null : `Season ${usernameSetSeason + 1}`,
    teamLockedUntil: canEditTeam ? null : `Season ${teamSetSeason + 1}`,
    currentSeasonId: season,
  };
}

export async function GET(req: Request) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  const walletAddress = (new URL(req.url).searchParams.get("walletAddress") ?? "").toLowerCase();
  if (!walletAddress) return Response.json({ error: "wallet_required" }, { status: 400 });

  const auth = await requireLinkedWallet(req, walletAddress);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const full = await profileWithStats(r.db, walletAddress);
  if (!full) return Response.json({ error: "not_found" }, { status: 404 });

  const season = await currentSeasonId();
  return Response.json({
    ...full.dto,
    ...editFlags(full.row.username_set_season, full.row.favourite_team_set_season, season),
  });
}

export async function PUT(req: Request) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const walletAddress = String(body.walletAddress ?? "").toLowerCase();
  if (!walletAddress) return Response.json({ error: "wallet_required" }, { status: 400 });

  const auth = await requireLinkedWallet(req, walletAddress);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const season = await currentSeasonId();
  const { data: existing } = await r.db
    .from("profiles")
    .select("*")
    .eq("wallet_address", walletAddress)
    .maybeSingle();

  // ── username ──
  let username: string | undefined = existing?.username;
  let usernameSetSeason: number | undefined = existing?.username_set_season;
  if (body.username !== undefined) {
    const uname = String(body.username).trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
      return Response.json({ error: "invalid_username" }, { status: 400 });
    }
    if (!existing || uname !== existing.username) {
      if (existing && existing.username_set_season >= season) {
        return Response.json({ error: "locked_until_next_season" }, { status: 403 });
      }
      const { data: clash } = await r.db
        .from("profiles")
        .select("wallet_address")
        .eq("username", uname)
        .neq("wallet_address", walletAddress)
        .maybeSingle();
      if (clash) return Response.json({ error: "username_taken" }, { status: 409 });
      username = uname;
      usernameSetSeason = season;
    }
  }

  // ── favourite team ──
  let teamId: number | undefined = existing?.favourite_team_id;
  let teamSetSeason: number | undefined = existing?.favourite_team_set_season;
  if (body.favouriteTeamId !== undefined) {
    const t = Number(body.favouriteTeamId);
    if (!Number.isInteger(t) || t < 0 || t > 19) {
      return Response.json({ error: "invalid_team" }, { status: 400 });
    }
    if (!existing || t !== existing.favourite_team_id) {
      if (existing && existing.favourite_team_set_season >= season) {
        return Response.json({ error: "locked_until_next_season" }, { status: 403 });
      }
      teamId = t;
      teamSetSeason = season;
    }
  }

  // ── bio (always editable) ──
  let bio: string = existing?.bio ?? "";
  if (body.bio !== undefined) {
    const b = String(body.bio);
    if (b.length > 160) return Response.json({ error: "invalid_bio" }, { status: 400 });
    bio = b;
  }

  if (!existing && username === undefined) {
    return Response.json({ error: "username_required" }, { status: 400 });
  }
  if (!existing && teamId === undefined) {
    return Response.json({ error: "team_required" }, { status: 400 });
  }

  const { data: saved, error } = await r.db
    .from("profiles")
    .upsert(
      {
        wallet_address: walletAddress,
        username: username as string,
        username_set_season: usernameSetSeason as number,
        favourite_team_id: teamId as number,
        favourite_team_set_season: teamSetSeason as number,
        bio,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" }
    )
    .select()
    .single();

  if (error || !saved) {
    console.error("[social] profile upsert failed:", error?.message ?? error);
    return Response.json({ error: "save_failed" }, { status: 500 });
  }

  const full = await profileWithStats(r.db, walletAddress);
  return Response.json({
    ...(full?.dto ?? {
      walletAddress,
      username: saved.username,
      favouriteTeamId: saved.favourite_team_id,
      bio: saved.bio ?? "",
      stats: { predictions: 0, settled: 0, wins: 0, winRateBps: 0, pnlTick: "0", rank: null },
      seasonId: season,
    }),
    ...editFlags(saved.username_set_season, saved.favourite_team_set_season, season),
  });
}
