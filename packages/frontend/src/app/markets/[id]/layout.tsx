/**
 * Route layout for /markets/[id] — provides dynamic social metadata.
 * The page itself is a client component, so metadata lives here.
 */

import type { Metadata } from "next";
import { createPublicClient, http, parseAbi, decodeAbiParameters, parseAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { isNumericId, siteUrl } from "../../api/social/og/_shared";

const FACTORY_ABI = parseAbi([
  "function marketInfo(uint256 marketId) external view returns (uint8 templateId, address creator, string creatorName, uint64 createdAt, uint64 bettingCloseTime, uint64 endTime, uint64 voidAfter, bytes params, uint8 outcomeCount)",
]);

async function marketQuestion(marketId: bigint): Promise<string | null> {
  try {
    const factory = process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS as `0x${string}`;
    if (!factory) return null;
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http("https://sepolia.base.org"),
    });
    const info = await client.readContract({
      address: factory,
      abi: FACTORY_ABI,
      functionName: "marketInfo",
      args: [marketId],
    });
    const [templateId, , creatorName, , , , , params] = info;
    // Reuse the same plain-language derivation as the app.
    const { TICKR_TEAMS } = await import("@tickr/shared/teams");
    const sym = (id: number | bigint) =>
      TICKR_TEAMS.find((t) => t.teamId === Number(id))?.symbol ?? `#${Number(id)}`;
    const nm = (id: number | bigint) =>
      TICKR_TEAMS.find((t) => t.teamId === Number(id))?.name ?? `Team #${Number(id)}`;
    if (templateId === 0) {
      const [, md] = decodeAbiParameters(parseAbiParameters("uint256, uint8"), params);
      return `Which coin gains the most on matchday ${Number(md) + 1}?`;
    }
    if (templateId === 1) return "Who will win the season championship?";
    if (templateId === 2) {
      const [a, b] = decodeAbiParameters(parseAbiParameters("uint16, uint16, uint64, uint64"), params);
      return `Will ${nm(a)} outperform ${nm(b)}?`;
    }
    if (templateId === 3) {
      const [teamId, target, , above] = decodeAbiParameters(
        parseAbiParameters("uint16, uint256, uint64, bool"),
        params
      );
      return `Will ${sym(teamId)} finish ${above ? "above" : "below"} $${(Number(target) / 1e8).toLocaleString()}?`;
    }
    if (templateId === 4) return "Will the home team cover the fixture spread?";
    void creatorName;
    return "TICKR prediction market";
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = siteUrl();
  const validId = isNumericId(id);
  const question = validId ? await marketQuestion(BigInt(id)) : null;
  const title = question ? `${question} — TICKR` : `Market ${id} — TICKR`;
  const description = question
    ? `${question} Stake TICK on the outcome.`
    : "Predict the outcome. Stake TICK. Climb the table.";

  const safeId = encodeURIComponent(id);
  const ogImage = `${site}/api/social/og/market/${safeId}`;
  const url = `${site}/markets/${safeId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "TICKR",
      type: "website",
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    alternates: { canonical: url },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return children;
}
