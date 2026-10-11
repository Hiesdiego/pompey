import { TICKR_TEAMS } from "@tickr/shared";

export type PriceHistoryPoint = { t: number; p: number; source: "Binance" | "CoinGecko" };

function validPoints(rows: unknown, source: PriceHistoryPoint["source"]): PriceHistoryPoint[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const values = row as unknown[];
    return { t: Number(values?.[0]), p: Number(values?.[source === "Binance" ? 4 : 1]), source };
  }).filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p) && point.p > 0);
}

export async function fetchPriceHistory(
  team: (typeof TICKR_TEAMS)[number],
  binanceBaseUrl: string,
  coingeckoBaseUrl: string,
  coingeckoApiKey: string,
  fetcher: typeof fetch = fetch,
): Promise<PriceHistoryPoint[]> {
  const binanceUrl = `${binanceBaseUrl.replace(/\/$/, "")}/api/v3/klines?symbol=${team.binanceSymbol}&interval=5m&limit=288`;
  try {
    const response = await fetcher(binanceUrl, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Binance history ${response.status}`);
    const points = validPoints(await response.json(), "Binance");
    if (points.length < 2) throw new Error("Binance history empty");
    return points;
  } catch (binanceError) {
    const coingeckoUrl = `${coingeckoBaseUrl.replace(/\/$/, "")}/coins/${encodeURIComponent(team.coingeckoId)}/market_chart?vs_currency=usd&days=1`;
    try {
      const response = await fetcher(coingeckoUrl, {
        signal: AbortSignal.timeout(8_000),
        headers: coingeckoApiKey ? { "x-cg-demo-api-key": coingeckoApiKey } : {},
      });
      if (!response.ok) throw new Error(`CoinGecko history ${response.status}`);
      const body = await response.json() as { prices?: unknown };
      const points = validPoints(body.prices, "CoinGecko");
      if (points.length < 2) throw new Error("CoinGecko history empty");
      return points;
    } catch (coingeckoError) {
      throw new Error(`Binance: ${String(binanceError)}; CoinGecko: ${String(coingeckoError)}`);
    }
  }
}
