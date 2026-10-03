/**
 * GET /api/social/profiles/by-wallet/[address] — public profile by wallet
 * address (for /me redirects and owner checks).
 */

import { dbOr503, profileWithStats } from "../../../_shared";

export const revalidate = 60;
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> }
) {
  const r = dbOr503();
  if ("response" in r) return r.response;

  const address = (await params).address.toLowerCase();
  if (new URL(_req.url).searchParams.get("usernameOnly") === "1") {
    const { data, error } = await r.db
      .from("profiles")
      .select("username")
      .eq("wallet_address", address)
      .maybeSingle();
    if (error) return Response.json({ error: "profile_lookup_failed" }, { status: 500 });
    if (!data) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json({ username: data.username });
  }

  const full = await profileWithStats(r.db, address);
  if (!full) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(full.dto);
}
