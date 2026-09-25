/**
 * Shared loading / empty / error states + section headings.
 */

"use client";

import { Loader2, SearchX, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
      <Loader2 className="h-5 w-5 animate-spin text-[#7F77DD]" />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-zinc-800 bg-[#141416] px-6 py-12 text-center">
      {icon ?? <SearchX className="h-8 w-8 text-zinc-600" />}
      <p className="font-semibold text-zinc-200">{title}</p>
      {children && <div className="text-sm text-zinc-400">{children}</div>}
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
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-900/50 bg-red-950/20 px-6 py-10 text-center">
      <TriangleAlert className="h-8 w-8 text-red-400" />
      <p className="text-sm text-red-200">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-lg border border-red-800 px-4 py-1.5 text-sm font-medium text-red-200 hover:bg-red-900/30"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
      {action}
    </div>
  );
}
