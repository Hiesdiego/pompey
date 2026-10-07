import { randomBytes } from "node:crypto";

// Shared by the page and its service worker URL. Generate it before Next
// compiles the client, so Vercel builds work without a post-build file edit.
const swBuildId = randomBytes(8).toString("hex");

/** @type {import('next').NextConfig} */
const backendApiUrl = (process.env.BACKEND_API_URL || "https://tickr-backend-3aca.onrender.com" || "http://localhost:4000").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SW_BUILD: swBuildId,
  },
  async rewrites() {
    return [{
      source: "/backend-api/:path*",
      destination: `${backendApiUrl}/:path*`,
    }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{
          key: "Cross-Origin-Opener-Policy",
          value: "same-origin-allow-popups",
        }],
      },
      {
        // The worker and its manifest must never be served from an
        // intermediary cache, or a deploy can sit invisible for hours.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "assets.coingecko.com" },
    ],
  },
};

export default nextConfig;
