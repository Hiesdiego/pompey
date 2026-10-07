import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crypto League Standings",
  description: "See how 20 cryptocurrencies rank in the TICKR league, with points, wins, draws, goals, and real price driven match results.",
  alternates: { canonical: "/standings" },
  openGraph: { url: "/standings", title: "Crypto League Standings | TICKR", description: "Follow the TICKR crypto league table and coin standings.", images: ["/tickr-hero.png"] },
};

export default function StandingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
