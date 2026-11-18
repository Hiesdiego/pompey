import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crypto and Stock Fixtures | TICKR",
  description: "Browse all TICKR crypto and stock fixtures by date, kickoff time, or league matchday.",
  alternates: { canonical: "/fixtures" },
  openGraph: { url: "/fixtures", title: "Crypto and Stock Fixtures | TICKR", description: "Follow TICKR crypto and stock fixtures, live scores, and results.", images: ["/tickr-hero.png"] },
};

export default function FixturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
