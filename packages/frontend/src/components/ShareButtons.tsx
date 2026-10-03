/**
 * ShareButtons — social sharing for matches and markets.
 *
 * X/Twitter, Telegram, WhatsApp + copy-link. The shared URL carries the
 * dynamic OG card (/api/og/...) so the preview mirrors the app state:
 * live score before FT, full-time score + payout after, market outcome +
 * resolver/creator.
 */

"use client";

import { useState } from "react";
import { Share2, Link2, Check, Send } from "lucide-react";
import { cn } from "../lib/cn";

function siteUrl(): string {
  if (typeof window !== "undefined") return window.location.origin;
  const v =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  return v.replace(/\/$/, "");
}

export function shareLinks(path: string, text: string): {
  x: string;
  telegram: string;
  whatsapp: string;
  url: string;
} {
  const url = `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const t = text.slice(0, 220);
  return {
    url,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}&url=${encodeURIComponent(url)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(t)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${t} ${url}`)}`,
  };
}

export function ShareButtons({
  path,
  text,
  compact = false,
  className,
}: {
  /** e.g. "/match/0" or "/markets/3" */
  path: string;
  /** Share text, e.g. "Bitcoin vs Shiba Inu on TICKR" */
  text: string;
  /** Compact icon-only row for cards. */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const links = shareLinks(path, text);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(links.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const btn =
    "flex items-center justify-center rounded-xl border border-black/10 bg-black/[.03] text-zinc-600 transition-all hover:border-[#2E7CF6]/60 hover:text-[#1D4ED8] active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300 dark:hover:border-[#2E7CF6]/60 dark:hover:text-[#7db3ff]";

  if (compact) {
    return (
      <div className={cn("relative", className)}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          aria-label="Share"
          className={cn(btn, "h-8 w-8")}
        >
          <Share2 className="h-4 w-4" />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 z-50 mt-2 flex gap-1 rounded-xl border border-black/10 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-zinc-900">
              <a
                href={links.x}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Share on X"
                className={cn(btn, "h-9 w-9 border-0")}
              >
                <XIcon className="h-4 w-4" />
              </a>
              <a
                href={links.telegram}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Share on Telegram"
                className={cn(btn, "h-9 w-9 border-0")}
              >
                <Send className="h-4 w-4" />
              </a>
              <a
                href={links.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Share on WhatsApp"
                className={cn(btn, "h-9 w-9 border-0")}
              >
                <WhatsAppIcon className="h-4 w-4" />
              </a>
              <button onClick={(e) => { e.stopPropagation(); void copy(); }} aria-label="Copy link" className={cn(btn, "h-9 w-9 border-0")}>
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Link2 className="h-4 w-4" />}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Share</span>
      <a href={links.x} target="_blank" rel="noopener noreferrer" aria-label="Share on X" className={cn(btn, "h-9 px-3 gap-2 text-sm font-semibold")}>
        <XIcon className="h-4 w-4" /> Post
      </a>
      <a href={links.telegram} target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram" className={cn(btn, "h-9 px-3 gap-2 text-sm font-semibold")}>
        <Send className="h-4 w-4" /> Telegram
      </a>
      <a href={links.whatsapp} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" className={cn(btn, "h-9 px-3 gap-2 text-sm font-semibold")}>
        <WhatsAppIcon className="h-4 w-4" /> WhatsApp
      </a>
      <button onClick={() => void copy()} aria-label="Copy link" className={cn(btn, "h-9 px-3 gap-2 text-sm font-semibold")}>
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Link2 className="h-4 w-4" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}
