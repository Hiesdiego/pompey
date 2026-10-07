"use client";

/**
 * PWA lifecycle: service worker registration, update prompt, install prompt,
 * and storage persistence.
 *
 * The important half is the *update* flow. Registration alone is easy; what
 * breaks real PWA deployments is a worker that takes over mid-session and
 * serves a new build's chunks to a DOM built from the old one. Our sw.js
 * therefore never skipWaiting()s on its own, and this component is the other
 * half of that contract: it notices a waiting worker, tells the user, and only
 * on an explicit click does it promote the worker and reload.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Download, X } from "lucide-react";

/** Chrome/Edge fire beforeinstallprompt; the rest ignore it. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const UPDATE_DISMISSED_KEY = "tickr-sw-update-dismissed";
const INSTALL_DISMISSED_KEY = "tickr-pwa-install-dismissed";

/**
 * Build stamp from next.config.mjs. It is also passed in the worker script URL,
 * so the worker uses it for cache names without editing public/sw.js.
 */
const CURRENT_BUILD = process.env.NEXT_PUBLIC_SW_BUILD ?? "dev";

function isMobileLike() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
  return iOS || /Android/i.test(ua);
}

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode, quota, etc. — not worth surfacing */
  }
}

export function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstall, setShowInstall] = useState(false);

  // A first install may claim this page; only an accepted update reloads it.
  const updateRequestedRef = useRef(false);
  const reloadingRef = useRef(false);

  const applyUpdate = useCallback(() => {
    const worker = waitingWorker;
    if (!worker) return;
    updateRequestedRef.current = true;
    worker.postMessage({ type: "SKIP_WAITING" });
  }, [waitingWorker]);

  /* ── registration + update detection ─────────────────────────────────── */
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | null = null;
    let cancelled = false;

    /**
     * A worker is parked. Suppress the bar only if the user dismissed the build
     * that produced it — keyed on the build stamp shared with the service
     * worker (NEXT_PUBLIC_SW_BUILD, injected by next.config).
     * The next deploy has a different stamp, so it re-surfaces instead of
     * being silenced forever by a single dismissal.
     */
    const surfaceIfNew = (worker: ServiceWorker) => {
      if (cancelled) return;
      if (readFlag(UPDATE_DISMISSED_KEY) === CURRENT_BUILD) return;
      setWaitingWorker(worker);
    };

    const track = (reg: ServiceWorkerRegistration) => {
      registration = reg;

      // A worker already parked from a previous visit.
      if (reg.waiting && navigator.serviceWorker.controller) {
        surfaceIfNew(reg.waiting);
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // "installed" + an existing controller == an update, not first run.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            surfaceIfNew(installing);
          }
        });
      });
    };

    const workerUrl = `/sw.js?v=${CURRENT_BUILD}`;
    navigator.serviceWorker
      .register(workerUrl, { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (cancelled) return;
        track(reg);
        void reg.update().catch(() => undefined);
      })
      .catch((error) => {
        console.error("TICKR service worker registration failed:", error);
      });

    // The new worker claimed this page — swap in the new build exactly once.
    const onControllerChange = () => {
      if (!updateRequestedRef.current) return;
      if (reloadingRef.current) return;
      if (!navigator.serviceWorker.controller) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    // Check for a deploy whenever the user comes back to the tab.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && registration) {
        void registration.update().catch(() => undefined);
      }
    };

    // A failed first registration (started offline, say) shouldn't be sticky.
    const onOnline = () => {
      navigator.serviceWorker
        .register(workerUrl, { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          if (!cancelled) track(reg);
        })
        .catch(() => undefined);
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  /* ── install prompt ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    // Already installed (standalone) → never prompt.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onBeforeInstall = (event: Event) => {
      const promptEvent = event as BeforeInstallPromptEvent;
      promptEvent.preventDefault();
      setInstallEvent(promptEvent);
      if (readFlag(INSTALL_DISMISSED_KEY) !== "1") {
        setShowInstall(true);
      }
    };

    const onInstalled = () => {
      setShowInstall(false);
      setInstallEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no beforeinstallprompt; offer the hint directly on mobile Safari.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes("Macintosh") && "ontouchend" in document);
    const iosSafari =
      isIOS &&
      !(window.navigator as Navigator & { standalone?: boolean }).standalone &&
      readFlag(INSTALL_DISMISSED_KEY) !== "1";
    if (iosSafari) setShowInstall(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /* ── storage persistence ─────────────────────────────────────────────── */
  useEffect(() => {
    // Ask once we know the app is installed — persisted storage keeps the
    // runtime caches from being evicted out from under an offline user.
    const onInstalled = () => {
      void navigator.storage?.persist?.().catch(() => undefined);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => window.removeEventListener("appinstalled", onInstalled);
  }, []);

  const dismissUpdate = () => {
    writeFlag(UPDATE_DISMISSED_KEY, CURRENT_BUILD);
    setWaitingWorker(null);
  };

  const dismissInstall = () => {
    writeFlag(INSTALL_DISMISSED_KEY, "1");
    setShowInstall(false);
  };

  const promptInstall = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setShowInstall(false);
    setInstallEvent(null);
  };

  return (
    <>
      {waitingWorker && (
        <UpdateBar onReload={applyUpdate} onDismiss={dismissUpdate} />
      )}
      {showInstall && !waitingWorker && (
        <InstallBar
          canPrompt={Boolean(installEvent)}
          onInstall={promptInstall}
          onDismiss={dismissInstall}
        />
      )}
    </>
  );
}

/* ── presentational pieces ─────────────────────────────────────────────── */

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="glass-strong fixed inset-x-4 bottom-4 z-[190] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-black/10 p-3 shadow-[0_16px_50px_rgba(0,0,0,.22)] sm:inset-x-auto sm:right-6 sm:bottom-6 dark:border-white/10"
    >
      {children}
    </div>
  );
}

function UpdateBar({ onReload, onDismiss }: { onReload: () => void; onDismiss: () => void }) {
  return (
    <Bar>
      <RefreshCw className="h-5 w-5 shrink-0 text-[#2E7CF6]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-zinc-900 dark:text-white">Update available</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          Reload to get the latest markets.
        </p>
      </div>
      <button
        onClick={onReload}
        className="gradient-cta shrink-0 rounded-xl px-3 py-2 text-xs font-bold"
      >
        Reload
      </button>
      <button
        onClick={onDismiss}
        aria-label="Dismiss update"
        className="shrink-0 rounded-full p-1 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Bar>
  );
}

function InstallBar({
  canPrompt,
  onInstall,
  onDismiss,
}: {
  canPrompt: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <Bar>
      <Download className="h-5 w-5 shrink-0 text-[#2E7CF6]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-zinc-900 dark:text-white">Install TICKR</p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {canPrompt ? "Add it to your home screen." : "Tap Share, then Add to Home Screen."}
        </p>
      </div>
      {canPrompt && (
        <button
          onClick={onInstall}
          className="gradient-cta shrink-0 rounded-xl px-3 py-2 text-xs font-bold"
        >
          Install
        </button>
      )}
      <button
        onClick={onDismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-full p-1 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Bar>
  );
}
