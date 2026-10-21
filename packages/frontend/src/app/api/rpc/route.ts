import { getChainEnv } from "@/lib/contracts";

export const runtime = "nodejs";

const READ_METHODS = new Set([
  "eth_blockNumber", "eth_call", "eth_chainId", "eth_estimateGas",
  "eth_feeHistory", "eth_gasPrice", "eth_getBalance", "eth_getBlockByHash",
  "eth_getBlockByNumber", "eth_getBlockReceipts", "eth_getCode",
  "eth_getLogs", "eth_getStorageAt", "eth_getTransactionByHash",
  "eth_getTransactionCount", "eth_getTransactionReceipt",
  "eth_getProof", "eth_maxPriorityFeePerGas", "net_version",
]);

function endpoints(): string[] {
  const mainnet = getChainEnv() === "mainnet";
  const configured = mainnet
    ? process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL
    : process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL;
  const fallbacks = mainnet
    ? process.env.NEXT_PUBLIC_BASE_MAINNET_FALLBACK_RPC_URLS
    : process.env.NEXT_PUBLIC_BASE_SEPOLIA_FALLBACK_RPC_URLS;
  const defaults = mainnet
    ? ["https://base-rpc.publicnode.com", "https://mainnet.base.org"]
    : ["https://base-sepolia-rpc.publicnode.com", "https://base-sepolia.rpc.sentio.xyz"];
  return [...new Set([configured, ...(fallbacks ?? "").split(","), ...defaults]
    .map((url) => url?.trim()).filter((url): url is string => !!url))]
    .filter((url) => {
      try { return new URL(url).protocol === "https:"; } catch { return false; }
    });
}

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 128_000) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 128_000) return new Response(null, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 100 || !calls.every((call) =>
    call && typeof call === "object" && READ_METHODS.has((call as { method?: string }).method ?? "")
  )) return new Response(null, { status: 400 });

  const payload = JSON.stringify(body);
  for (const url of endpoints()) {
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!upstream.ok) continue;
      return new Response(await upstream.text(), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    } catch {
      // Try the next configured RPC.
    }
  }
  return Response.json({ jsonrpc: "2.0", id: (calls[0] as { id?: unknown }).id ?? null,
    error: { code: -32000, message: "Network reads are temporarily unavailable" } },
  { status: 503, headers: { "cache-control": "no-store" } });
}
