import type { Metadata } from "next";
import { backendUrl, isNumericId, siteUrl } from "../../../api/social/og/_shared";

export const revalidate = 60;

interface StockFixtureMetadata {
  home?: { name: string } | null;
  away?: { name: string } | null;
  settled?: boolean;
  homeGoals?: number | null;
  awayGoals?: number | null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = siteUrl();
  let title = `Match ${id} — TICKR`;
  let description = "Stock Price Prediction League.";

  try {
    const res = isNumericId(id)
      ? await fetch(`${backendUrl()}/api/stocks/fixtures/${id}`, { next: { revalidate: 60 } })
      : null;
    if (res?.ok) {
      const fixture = (await res.json()) as StockFixtureMetadata;
      if (fixture.home && fixture.away) {
        title = `${fixture.home.name} vs ${fixture.away.name} — TICKR`;
        if (fixture.settled) {
          const score = fixture.homeGoals != null && fixture.awayGoals != null
            ? `${fixture.homeGoals}–${fixture.awayGoals}`
            : "FT";
          title = `${fixture.home.name} ${score} ${fixture.away.name} — TICKR`;
          description = `Full-time result: ${title.replace(/ — TICKR$/, "")}.`;
        } else {
          description = `${fixture.home.name} take on ${fixture.away.name} on TICKR — back your team and climb the table.`;
        }
      }
    }
  } catch {
    title = `Match ${id} — TICKR`;
    description = "Stock Price Prediction League.";
  }

  const safeId = encodeURIComponent(id);
  const ogTitle = title.replace(/\s+—\s+TICKR$/, "");
  const ogImage = `${site}/api/social/og/match/${safeId}?league=stocks&v=2&title=${encodeURIComponent(ogTitle)}`;
  const url = `${site}/stocks/match/${safeId}`;

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

export default function StockMatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
