import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crypto Prediction Markets",
  description: "Browse TICKR crypto prediction markets on Base, including coin matchups, price targets, and season outcomes.",
  alternates: { canonical: "/markets" },
  openGraph: { url: "/markets", title: "Crypto Prediction Markets | TICKR", description: "Explore crypto prediction markets on Base.", images: ["/tickr-hero.png"] },
};

export default function MarketsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
