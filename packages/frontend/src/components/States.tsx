/**
 * Shared loading / empty / error states + section headings.
 */

"use client";

import { Loader2, SearchX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2.5 py-12 text-sm text-zinc-500 dark:text-zinc-400">
      <Loader2 className="h-5 w-5 animate-spin text-[#2E7CF6]" />
      <span className="font-medium">{label}</span>
    </div>
  );
}

/** Shimmer skeleton rows for lists/tables while data loads. */
export function SkeletonRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-14 w-full" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

/** Shimmer skeleton cards for grids while data loads. */
export function SkeletonCards({ cards = 3, className = "" }: { cards?: number; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)} aria-hidden>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="skeleton h-40 w-full" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

/**
 * Shape-matched skeleton for the market detail page — mirrors the real
 * layout (hero + odds board + sidebar CTA) so the page doesn't jump when
 * data lands.
 */
export function SkeletonMarketDetail() {
  return (
    <div aria-hidden>
      {/* Hero */}
      <div className="mb-6 rounded-[2rem] p-6 sm:p-9">
        <div className="flex items-center justify-between">
          <div className="skeleton h-7 w-32 rounded-full" />
          <div className="skeleton h-7 w-24 rounded-full" />
        </div>
        <div className="skeleton mt-6 h-9 w-3/4 rounded-xl sm:h-12" />
        <div className="skeleton mt-3 h-9 w-1/2 rounded-xl sm:h-12" />
        <div className="mt-7 flex flex-wrap gap-x-7 gap-y-4 border-t border-black/5 pt-5 dark:border-white/10">
          <div className="skeleton h-10 w-28 rounded-xl" />
          <div className="skeleton h-10 w-24 rounded-xl" />
          <div className="skeleton h-10 w-28 rounded-xl" />
        </div>
      </div>
      {/* Odds board + sidebar */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="glass mb-6 rounded-2xl p-6 lg:col-span-2 lg:mb-0">
          <div className="skeleton mb-4 h-6 w-20 rounded-lg" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-[76px] w-full rounded-2xl" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
        </div>
        <div className="glass mb-6 self-start rounded-2xl p-5 lg:mb-0">
          <div className="skeleton mx-auto h-4 w-20 rounded-lg" />
          <div className="skeleton mx-auto mt-3 h-10 w-24 rounded-xl" />
          <div className="skeleton mt-5 h-14 w-full rounded-2xl" />
          <div className="skeleton mx-auto mt-3 h-3 w-40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-center gap-2 rounded-2xl px-6 py-12 text-center">
      {icon ?? <SearchX className="h-8 w-8 text-zinc-400 dark:text-zinc-600" />}
      <p className="font-display font-semibold text-zinc-800 dark:text-zinc-200">{title}</p>
      {message && <p className="text-sm text-zinc-500 dark:text-zinc-400">{message}</p>}
      {children && <div className="text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-2xl border-red-500/25! px-6 py-10 text-center">
      <TriangleAlert className="h-8 w-8 text-red-500 dark:text-red-400" />
      <p className="text-sm text-red-600 dark:text-red-200">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-xl border border-red-500/30 px-4 py-1.5 text-sm font-semibold text-red-600 transition-all hover:bg-red-500/10 active:scale-95 dark:text-red-200"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-zinc-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
