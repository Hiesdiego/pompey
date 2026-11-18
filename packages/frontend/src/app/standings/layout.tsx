import type { Metadata } from "next";
import { siteUrl } from "@/lib/siteUrl";

const standingsImage = `${siteUrl()}/api/social/og/standings`;

export const metadata: Metadata = {
  title: "Crypto and Stock League Standings | TICKR",
  description: "Compare the TICKR crypto and stock leagues, with points, wins, draws, goals, and match results.",
  alternates: { canonical: "/standings" },
  openGraph: { url: `${siteUrl()}/standings`, title: "Crypto and Stock League Standings | TICKR", description: "Follow both TICKR league tables.", images: [{ url: standingsImage, width: 1200, height: 630, alt: "TICKR crypto league standings" }] },
  twitter: { card: "summary_large_image", title: "Crypto and Stock League Standings | TICKR", description: "Follow both TICKR league tables.", images: [standingsImage] },
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
