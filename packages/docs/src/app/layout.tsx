import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.tickrbase.top"),
  title: { default: "Tickr Docs — Understand the game", template: "%s | Tickr Docs" },
  description: "The definitive guide to Tickr: how to play, match scoring, price sources, settlement, contracts and the API.",
  openGraph: { title: "Tickr Docs", description: "Every rule. Every price. Every result.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
