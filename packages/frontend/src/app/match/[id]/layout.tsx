import { leagueScore } from "../../api/social/og/_league";
import { SEASON_ID } from "@/lib/contracts";


import type { Metadata } from "next";
import { backendUrl, isNumericId, siteUrl } from "../../api/social/og/_shared";

export const revalidate = 60;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = siteUrl();
  const validId = isNumericId(id);

  let title = `Match ${id} â€” TICKR`;
  let description = "Crypto Price Prediction League.";
  try {
    const res = validId
      ? await fetch(`${backendUrl()}/api/fixtures/${id}`, { next: { revalidate: 60 } })
      : null;
    if (res?.ok) {
      const f = (await res.json()) as {
        home?: { name: string } | null;
        away?: { name: string } | null;
        settled?: boolean;
        seasonId?: string;
      };
      if (f?.home && f?.away) {
        title = `${f.home.name} vs ${f.away.name} â€” TICKR`;
        const score = f.settled ? await leagueScore(id, f.seasonId ?? SEASON_ID) : null;
        if (f.settled) title = `${f.home.name} ${score ? `${score[0]}–${score[1]}` : "FT"} ${f.away.name} — TICKR`;
        description = f.settled
          ? `Full-time result: ${title.replace(/ — TICKR$/, "")}.`
          : `${f.home.name} take on ${f.away.name} on TICKR â€” back your team and climb the table.`;
      }
    }
  } catch {
    title = `Match ${id} â€” TICKR`;
    description = "Crypto Price Prediction League.";
  }

  const safeId = encodeURIComponent(id);
  const ogImage = `${site}/api/social/og/match/${safeId}?v=2&title=${encodeURIComponent(title.replace(/\s+â€”\s+TICKR$/, ""))}`;
  const url = `${site}/match/${safeId}`;

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

export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
