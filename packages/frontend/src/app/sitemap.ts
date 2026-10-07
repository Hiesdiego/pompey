import type { MetadataRoute } from "next";
import { siteUrl } from "../lib/siteUrl";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteUrl();
  const entries: Array<{ path: string; priority: number; changeFrequency: "daily" | "monthly" | "yearly" }> = [
    { path: "", priority: 1, changeFrequency: "daily" },
    { path: "/fixtures", priority: 0.8, changeFrequency: "daily" },
    { path: "/standings", priority: 0.8, changeFrequency: "daily" },
    { path: "/markets", priority: 0.8, changeFrequency: "daily" },
    { path: "/how-to-play", priority: 0.8, changeFrequency: "monthly" },
    { path: "/about", priority: 0.8, changeFrequency: "monthly" },
    { path: "/roadmap", priority: 0.5, changeFrequency: "monthly" },
    { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
    { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  ];
  return entries.map(({ path, ...rest }) => ({ url: `${origin}${path || "/"}`, ...rest }));
}
