import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crypto Coin Fixtures and Match Schedule",
  description: "Explore TICKR's crypto coin fixtures, matchdays, live scores, and results. Each match is settled by real cryptocurrency price performance.",
  alternates: { canonical: "/fixtures" },
  openGraph: { url: "/fixtures", title: "Crypto Coin Fixtures and Match Schedule | TICKR", description: "Follow TICKR crypto coin fixtures, live scores, and results.", images: ["/tickr-hero.png"] },
};

export default function FixturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
