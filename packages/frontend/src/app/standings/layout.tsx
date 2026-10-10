import type { Metadata } from "next";
import { siteUrl } from "@/lib/siteUrl";

const standingsImage = `${siteUrl()}/api/social/og/standings`;

export const metadata: Metadata = {
  title: "Crypto League Standings",
  description: "See how 20 cryptocurrencies rank in the TICKR league, with points, wins, draws, goals, and real price driven match results.",
  alternates: { canonical: "/standings" },
  openGraph: { url: `${siteUrl()}/standings`, title: "Crypto League Standings | TICKR", description: "Follow the TICKR crypto league table and coin standings.", images: [{ url: standingsImage, width: 1200, height: 630, alt: "Top eight teams in the TICKR crypto fantasy league" }] },
  twitter: { card: "summary_large_image", title: "Crypto League Standings | TICKR", description: "Follow the TICKR crypto league table and coin standings.", images: [standingsImage] },
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
