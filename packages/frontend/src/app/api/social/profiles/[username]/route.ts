/**
 * GET /api/social/profiles/[username] — public profile (username matched
 * case-insensitively; leading "@" tolerated).
 */

import { dbOr503, profileWithStats } from "../../_shared";

export const revalidate = 60;
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  const raw = decodeURIComponent((await params).username);
  const username = (raw.startsWith("@") ? raw.slice(1) : raw).toLowerCase();

  const { data: hit } = await r.db
    .from("profiles")
    .select("wallet_address")
    .eq("username", username)
    .maybeSingle();
  if (!hit) return Response.json({ error: "not_found" }, { status: 404 });

  const full = await profileWithStats(r.db, (hit as { wallet_address: string }).wallet_address);
  if (!full) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(full.dto);
}
