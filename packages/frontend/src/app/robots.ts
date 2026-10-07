import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/api/social/og/"],
      disallow: ["/api/", "/claims", "/watchlist", "/markets/create"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
