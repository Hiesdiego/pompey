import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots { const base=(process.env.NEXT_PUBLIC_DOCS_URL||"https://docs.tickrbase.top").replace(/\/$/,""); return {rules:{userAgent:"*",allow:"/"},sitemap:`${base}/sitemap.xml`}; }
