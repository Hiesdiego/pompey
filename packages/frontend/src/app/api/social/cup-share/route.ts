import { dbOr503 } from "../_shared";
import { requireLinkedWallet } from "@/lib/privyServer";
import { ACTIVE_CHAIN_ID } from "@/lib/contracts";
import { CUP_CONTRACTS } from "@/lib/cup";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const result = dbOr503();
  if ("response" in result) return result.response;
  let body: { walletAddress?: string; marketKind?: string; marketId?: number; postUrl?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_body" }, { status: 400 }); }
  const wallet = (body.walletAddress ?? "").toLowerCase();
  const kind = body.marketKind;
  const id = body.marketId;
  if (!/^0x[a-f0-9]{40}$/.test(wallet) || !["match", "spread", "outright"].includes(kind ?? "") || !Number.isSafeInteger(id) || (id ?? -1) < 0 || (kind === "outright" && id !== 0)) return Response.json({ error: "invalid_prediction" }, { status: 400 });
  const auth = await requireLinkedWallet(req, wallet);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  let url: URL;
  try { url = new URL(body.postUrl ?? ""); } catch { return Response.json({ error: "invalid_post_url" }, { status: 400 }); }
  if (url.protocol !== "https:" || !["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase()) || !/^\/[A-Za-z0-9_]{1,15}\/status\/\d+$/.test(url.pathname)) return Response.json({ error: "invalid_post_url" }, { status: 400 });
  const poolAddresses = kind === "match"
    ? [...new Set([CUP_CONTRACTS.matchPool.toLowerCase(), CUP_CONTRACTS.pool.toLowerCase()])]
    : [CUP_CONTRACTS.pool.toLowerCase()];
  const { data: prediction, error: readError } = await result.db.from("cup_prediction_events")
    .select("pool_address,tx_hash").eq("chain_id", ACTIVE_CHAIN_ID).eq("wallet_address", wallet)
    .eq("market_kind", kind).eq("market_id", id).in("pool_address", poolAddresses).limit(1).maybeSingle();
  if (readError) return Response.json({ error: "share_unavailable" }, { status: 503 });
  if (!prediction) return Response.json({ error: "prediction_not_indexed" }, { status: 409 });
  const scope = { chain_id: ACTIVE_CHAIN_ID, pool_address: prediction.pool_address, wallet_address: wallet, market_kind: kind, market_id: id };
  const { error } = await result.db.from("cup_x_shares").upsert({ ...scope, post_url: `${url.origin}${url.pathname}` }, { onConflict: "chain_id,pool_address,wallet_address,market_kind,market_id", ignoreDuplicates: true });
  if (error) return Response.json({ error: error.code === "23505" ? "post_already_used" : "share_unavailable" }, { status: error.code === "23505" ? 409 : 503 });
  return Response.json({ recorded: true });
}
