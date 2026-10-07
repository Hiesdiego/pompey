import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/siteUrl";
import { backendUrl } from "./api/social/og/_shared";

export const revalidate = 300;

type Fixture = { fixtureId: string | number };
type Market = { id: string | number };

async function catalogue<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${backendUrl()}${path}`, {
      next: { revalidate },
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok ? (await response.json()) as T : null;
  } catch {
    // Keep the static sitemap available while the backend is restarting.
    return null;
  }
}

function validId(value: unknown): string | null {
  const id = String(value);
  return /^(0|[1-9]\d{0,77})$/.test(id) ? id : null;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  const entries: Array<{ path: string; priority: number; changeFrequency: "daily" | "monthly" | "yearly" }> = [
    { path: "", priority: 1, changeFrequency: "daily" },
    { path: "/fixtures", priority: 0.8, changeFrequency: "daily" },
    { path: "/standings", priority: 0.8, changeFrequency: "daily" },
    { path: "/markets", priority: 0.8, changeFrequency: "daily" },
    { path: "/how-to-play", priority: 0.8, changeFrequency: "monthly" },
    { path: "/about", priority: 0.8, changeFrequency: "monthly" },
    { path: "/roadmap", priority: 0.5, changeFrequency: "monthly" },
    { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  ];
  const staticUrls = entries.map(({ path, ...rest }) => ({ url: `${origin}${path || "/"}`, ...rest }));
  const [fixtures, marketResponse] = await Promise.all([
    catalogue<Fixture[]>("/api/fixtures"),
    catalogue<{ ok: boolean; data?: { markets?: Market[] } }>("/api/chain/markets"),
  ]);

  const matchUrls = Array.isArray(fixtures)
    ? fixtures.flatMap((fixture) => {
        const id = validId(fixture?.fixtureId);
        return id ? [{ url: `${origin}/match/${id}` }] : [];
      })
    : [];
  const markets = marketResponse?.ok ? marketResponse.data?.markets : null;
  const marketUrls = Array.isArray(markets)
    ? markets.flatMap((market) => {
        const id = validId(market?.id);
        return id ? [{ url: `${origin}/markets/${id}` }] : [];
      })
    : [];

  return [...staticUrls, ...matchUrls, ...marketUrls];
}
