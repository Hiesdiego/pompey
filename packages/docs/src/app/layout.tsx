import type { Metadata } from "next";
import "./globals.css";

const docsUrl = (process.env.NEXT_PUBLIC_DOCS_URL || "https://docs.tickrbase.top").replace(/\/$/, "");
const description = "Official Tickr documentation for the crypto prediction league. Learn how fixtures, TICK staking, price sources, match scoring, onchain settlement, payouts, markets and contracts work.";

export const metadata: Metadata = {
  metadataBase: new URL(docsUrl),
  applicationName: "Tickr Docs",
  title: { default: "Tickr Docs | Rules, Price Sources & Onchain Settlement", template: "%s | Tickr Docs" },
  description,
  keywords: ["Tickr", "Tickr docs", "crypto prediction league", "TICK staking", "crypto price sources", "match scoring", "onchain settlement", "Base Sepolia"],
  category: "Documentation",
  creator: "Tickr",
  publisher: "Tickr",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  icons: { icon: "/tickr-icon.svg", shortcut: "/tickr-icon.svg" },
  openGraph: { type: "website", locale: "en_US", url: docsUrl, siteName: "Tickr Docs", title: "Tickr Docs | Rules, Price Sources & Onchain Settlement", description, images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Tickr documentation: every rule, every price, every result" }] },
  twitter: { card: "summary_large_image", site: "@tickrbase", title: "Tickr Docs | Rules, Prices & Settlement", description, images: ["/opengraph-image"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Tickr Docs",
    url: docsUrl,
    description,
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Tickr", url: "https://tickrbase.top", logo: `${docsUrl}/tickr-icon.svg` },
  };
  return <html lang="en"><body><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />{children}</body></html>;
}
