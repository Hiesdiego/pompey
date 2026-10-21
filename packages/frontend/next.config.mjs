import { randomBytes } from "node:crypto";

const swBuildId = randomBytes(8).toString("hex");

const backendApiUrl = (process.env.BACKEND_API_URL || "https://tickr-backend-3aca.onrender.com").replace(/\/$/, "");

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
