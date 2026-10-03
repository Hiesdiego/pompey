import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const BUILD_ID_PATH = join(ROOT, ".next", "BUILD_ID");

/**
 * The same build stamp scripts/stamp-sw.mjs bakes into the service worker.
 * Exposed to the client so the update banner can tell "this build" from
 * "a build the user already dismissed" — sw.js itself can't be read from the
 * page, so both sides derive the value from .next/BUILD_ID the same way.
 *
 * Read lazily (at request time) rather than at module load: next.config is
 * evaluated before `next build` writes BUILD_ID on a cold build.
 */
function swBuildId() {
  let seed;
  try {
    seed = existsSync(BUILD_ID_PATH) ? readFileSync(BUILD_ID_PATH, "utf8").trim() : "";
  } catch {
    seed = "";
  }
  if (!seed) return "dev";
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/** @type {import('next').NextConfig} */
const backendApiUrl = (process.env.BACKEND_API_URL || "https://tickr-backend-3aca.onrender.com" || "http://localhost:4000").replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SW_BUILD: swBuildId(),
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
