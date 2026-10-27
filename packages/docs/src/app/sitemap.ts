import type { MetadataRoute } from "next";
import { docs } from "../lib/content";
export default function sitemap(): MetadataRoute.Sitemap { const base=(process.env.NEXT_PUBLIC_DOCS_URL||"https://docs.tickrbase.top").replace(/\/$/,""); return [{url:base,changeFrequency:"weekly",priority:1},...docs.map(d=>({url:`${base}/${d.slug}`,changeFrequency:"monthly" as const,priority:.7}))]; }
