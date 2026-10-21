import { dbOr503 } from "../_shared";
import { requireLinkedWallet } from "@/lib/privyServer";
import { CUP_FAVORITE_START, CUP_FAVORITE_END } from "@/lib/cup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: Request) {
  const result = dbOr503();
  if ("response" in result) return result.response;
  let body: { walletAddress?: string; teamId?: number };
  try { body = await req.json(); }
  catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  const wallet = (body.walletAddress ?? "").toLowerCase();
  const teamId = body.teamId;
  if (!/^0x[a-f0-9]{40}$/.test(wallet) || typeof teamId !== "number" || !Number.isInteger(teamId) || teamId < 0 || teamId >= 64) {
    return Response.json({ error: "invalid_pick" }, { status: 400 });
  }
  const auth = await requireLinkedWallet(req, wallet);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const now = Date.now();
  if (now < CUP_FAVORITE_START || now >= CUP_FAVORITE_END) {
    return Response.json({ error: "outside_cup_period" }, { status: 403 });
  }
  const { data, error } = await result.db.from("profiles")
    .update({ cup_favourite_team_id: teamId })
    .eq("wallet_address", wallet)
    .is("cup_favourite_team_id", null)
    .select("cup_favourite_team_id")
    .maybeSingle();
  if (error) return Response.json({ error: "save_failed" }, { status: 500 });
  if (!data) return Response.json({ error: "profile_missing_or_already_picked" }, { status: 409 });
  return Response.json({ cupFavouriteTeamId: data.cup_favourite_team_id });
}
