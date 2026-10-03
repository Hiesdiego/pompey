/**
 * Stamps a unique build id into the service worker.
 *
 * Next fingerprints everything under `_next/static` but serves `public/`
 * verbatim — so sw.js itself has a stable URL and could be held in an
 * intermediary cache. More importantly, the SW's cache name must change on
 * every deploy or the activate-time purge never fires (see the header comment
 * in public/sw.js). We take the Next build id, hash it, and replace the
 * __SW_BUILD__ placeholder.
 *
 * Runs as `postbuild`, so it reads the build id `next build` just produced.
 * Idempotent: re-running against an already-stamped file is a no-op because
 * the placeholder is gone.
 *
 * Run: node scripts/stamp-sw.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SW_PATH = join(ROOT, "public", "sw.js");
const BUILD_ID_PATH = join(ROOT, ".next", "BUILD_ID");
const PLACEHOLDER = "__SW_BUILD__";

if (!existsSync(SW_PATH)) {
  console.error(`stamp-sw: ${SW_PATH} not found`);
  process.exit(1);
}

let source = readFileSync(SW_PATH, "utf8");
if (!source.includes(PLACEHOLDER)) {
  console.log("stamp-sw: already stamped, nothing to do");
  process.exit(0);
}

// Prefer Next's build id; fall back to a timestamp so a stray run outside
// `next build` still produces a valid, unique worker rather than a broken one.
let seed;
if (existsSync(BUILD_ID_PATH)) {
  seed = readFileSync(BUILD_ID_PATH, "utf8").trim();
} else {
  console.warn("stamp-sw: .next/BUILD_ID missing — falling back to a timestamp");
  seed = `fallback-${Date.now()}`;
}

const version = createHash("sha256").update(seed).digest("hex").slice(0, 12);
writeFileSync(SW_PATH, source.replaceAll(PLACEHOLDER, version), "utf8");
console.log(`stamp-sw: build ${seed} -> cache version ${version}`);
