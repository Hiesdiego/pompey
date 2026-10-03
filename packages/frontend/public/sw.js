/**
 * TICKR service worker.
 *
 * Design notes (why it looks like this):
 *
 * 1. CACHE_NAME is stamped at build time. `next build` runs
 *    scripts/stamp-sw.mjs, which replaces __SW_BUILD__ with the Next build id.
 *    Without a changing name the activate-time purge can never fire (the old
 *    worker's name IS the current name), so stale `_next/static` chunks get
 *    served forever and deploys appear to do nothing. This is the whole reason
 *    the previous sw.js was broken.
 *
 * 2. We never call skipWaiting() during install. Swapping the controller
 *    underneath a live tab means the DOM was built from one build's JS while
 *    subsequent chunk requests resolve against another's cache — the classic
 *    "white screen until hard refresh". The page decides when to take over:
 *    it postMessages {type:"SKIP_WAITING"} and reloads once, deliberately.
 *
 * 3. Navigation is network-first with a deadline, not network-only. The shell
 *    is precached, but the *content* is per-route; a network-first strategy
 *    means a working connection always wins (users never see a stale market),
 *    while an offline or flaky one still lands on a real page.
 *
 * 4. RSC payload requests (?_rsc=) are cached separately from HTML for the
 *    same URL. Next's App Router asks for the flight payload on client-side
 *    navigations; if we returned the cached HTML document instead, the router
 *    would choke on it. Keying the cache by the full URL (query included)
 *    keeps the two apart.
 *
 * 5. /backend-api and /api are pass-through. Never cache money. Live prices
 *    and balances must not be served from a cache that outlives the response.
 */

const VERSION = "__SW_BUILD__";
const SHELL_CACHE = `tickr-shell-${VERSION}`;
const RUNTIME_CACHE = `tickr-runtime-${VERSION}`;
const IMAGE_CACHE = `tickr-images-${VERSION}`;
const CACHE_PREFIX = "tickr-";
const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE, IMAGE_CACHE];

/** Page shell + offline fallback. Hashed build assets are cached at runtime. */
const APP_SHELL = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

/** Network-first deadline for navigations, in ms. */
const NAV_TIMEOUT = 4000;
/** Runtime cache ceiling (entries). Unbounded caches are a footgun on mobile. */
const RUNTIME_LIMIT = 80;
const IMAGE_LIMIT = 120;

/* ── install ───────────────────────────────────────────────────────────── */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 can't abort the whole install.
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
        ),
      );
      // Deliberately NO skipWaiting() — see note 2.
    })(),
  );
});

/* ── activate ──────────────────────────────────────────────────────────── */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Purge every cache from a previous build.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key)),
      );

      // Navigation preload doubles requests on slow links; we do our own
      // network-first handling, so turn it off where supported.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.disable();
        } catch {
          /* not fatal */
        }
      }

      await self.clients.claim();
    })(),
  );
});

/* ── messages from the page ────────────────────────────────────────────── */

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (data && data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(SHELL_CACHE).then((cache) =>
        Promise.all(
          data.urls
            .filter((u) => typeof u === "string" && u.startsWith("/"))
            .map((u) => cache.add(new Request(u, { cache: "reload" })).catch(() => undefined)),
        ),
      ),
    );
  }
});

/* ── helpers ───────────────────────────────────────────────────────────── */

function isCacheable(response) {
  // Only same-origin, non-opaque, successful, non-partial responses are safe
  // to store and replay. A 206 or an opaque cross-origin body will poison a
  // cache and the bug surfaces much later as corrupt JS.
  return (
    response &&
    response.status === 200 &&
    response.type === "basic" &&
    !response.headers.get("content-range")
  );
}

async function putIfCacheable(cacheName, request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
}

/** Drop oldest entries once a cache exceeds its limit (insertion order). */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

/** Network-first, with a deadline, falling back to cache. */
async function networkFirst(request, cacheName, { timeout } = {}) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request).then((response) => {
    if (isCacheable(response)) {
      cache.put(request, response.clone()).then(
        () => trimCache(cacheName, RUNTIME_LIMIT),
        () => undefined,
      );
    }
    return response;
  });

  if (!cached) {
    return network;
  }

  if (!timeout) {
    try {
      return await network;
    } catch {
      return cached;
    }
  }

  // Race the network against the deadline; keep the slower fetch alive so it
  // still lands in the cache for next time.
  let timer;
  const guarded = network.catch(() => undefined);
  const winner = await Promise.race([
    guarded,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeout);
    }),
  ]);
  clearTimeout(timer);
  return winner || cached;
}

/** Cache-first, for content-hashed assets that can never change under a URL. */
async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(request, response.clone());
    if (limit) void trimCache(cacheName, limit);
  }
  return response;
}

/** Stale-while-revalidate, for images and other slow-changing binaries. */
async function staleWhileRevalidate(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        await cache.put(request, response.clone());
        if (limit) void trimCache(cacheName, limit);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error("offline and uncached");
}

async function offlineFallback() {
  const cache = await caches.open(SHELL_CACHE);
  return (
    (await cache.match("/offline.html")) ||
    new Response("Offline", { status: 503, statusText: "Offline" })
  );
}

/* ── fetch ─────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch non-GET or cross-origin traffic.
  if (request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Live data is never cached: money, prices, balances, auth.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/backend-api/") ||
    url.pathname.startsWith("/_next/data/") ||
    url.pathname.startsWith("/_next/webpack-hmr")
  ) {
    return;
  }

  // Client-side App Router transitions request the same URL with ?_rsc=<hash>.
  // Those are flight payloads, not documents — cache them by full URL and let
  // them fail softly so the router falls back instead of rendering HTML.
  const isRsc = url.searchParams.has("_rsc");
  if (isRsc) {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE).catch(
        () => new Response("", { status: 504, statusText: "Offline" }),
      ),
    );
    return;
  }

  // Documents: network-first with a deadline, then cache, then offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE, { timeout: NAV_TIMEOUT }).catch(offlineFallback),
    );
    return;
  }

  // Immutable, content-hashed build output: cache-first is always correct.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, SHELL_CACHE, RUNTIME_LIMIT));
    return;
  }

  const isImage =
    request.destination === "image" ||
    /\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i.test(url.pathname);
  if (isImage) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, IMAGE_LIMIT));
    return;
  }

  const isStatic =
    url.pathname.startsWith("/tickr-logo/") ||
    url.pathname.startsWith("/tickr-meta/") ||
    url.pathname.startsWith("/screenshots/") ||
    /\.(?:css|js|mjs|woff2?|ttf|otf|json|webmanifest|txt|xml)$/i.test(url.pathname) ||
    url.pathname === "/manifest.webmanifest";
  if (isStatic) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE, RUNTIME_LIMIT));
    return;
  }

  // Everything else: network-first, and if that fails, let the request proceed
  // normally rather than inventing a response we can't justify.
});
