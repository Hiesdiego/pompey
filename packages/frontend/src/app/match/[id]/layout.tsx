/**
 * Route layout for /match/[id] — provides dynamic social metadata.
 * The page itself is a client component, so metadata lives here.
 */

import type { Metadata } from "next";
import { backendUrl, isNumericId, siteUrl } from "../../api/social/og/_shared";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const site = siteUrl();
  const validId = isNumericId(id);

  let title = `Match ${id} — TICKR`;
  let description = "Predict the outcome. Stake TICK. Climb the table.";
  try {
    const res = validId
      ? await fetch(`${backendUrl()}/api/fixtures/${id}`, { next: { revalidate: 60 } })
      : null;
    if (res?.ok) {
      const f = (await res.json()) as {
        home?: { name: string } | null;
        away?: { name: string } | null;
        settled?: boolean;
      };
      if (f?.home && f?.away) {
        title = `${f.home.name} vs ${f.away.name} — TICKR`;
        description = f.settled
          ? `Full-time result: ${f.home.name} vs ${f.away.name} on TICKR.`
          : `${f.home.name} take on ${f.away.name} on TICKR — predict the winner and stake TICK.`;
      }
    }
  } catch {
    /* fallback title stands */
  }

  const safeId = encodeURIComponent(id);
  const ogImage = `${site}/api/social/og/match/${safeId}`;
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
