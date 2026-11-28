import type { Metadata } from "next";
import { siteUrl } from "../../lib/siteUrl";

const title = "Meme Arena | Weekly Meme Cup on Base";
const description = "Follow the Weekly Meme Cup on Base: live brackets, past champions, meme rankings and cup titles. Predict meme performance with TICK on TICKR.";

export const metadata: Metadata = {
  title: { absolute: `${title} | TICKR` }, description,
  alternates: { canonical: "/arena" },
  openGraph: { type: "website", url: "/arena", siteName: "TICKR", title, description,
    images: [{ url: "/meme-arena/image.png", width: 1200, height: 630, alt: "TICKR Meme Arena: The Weekly Meme Cup on Base" }] },
  twitter: { card: "summary_large_image", title, description, images: ["/meme-arena/image.png"] },
};

export default function ArenaLayout({ children }: { children: React.ReactNode }) {
  const data = { "@context": "https://schema.org", "@type": "CollectionPage", name: title,
    description, url: `${siteUrl()}/arena`, image: `${siteUrl()}/meme-arena/image.png`,
    isPartOf: { "@type": "WebSite", name: "TICKR", url: siteUrl() } };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />{children}</>;
}
