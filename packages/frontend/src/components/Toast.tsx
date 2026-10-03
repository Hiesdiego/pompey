/**
 * Toast — minimal dependency-free toast system.
 *
 * Used for one-tap transaction feedback: the moment a sponsored tx returns
 * a hash we toast "Stake submitted ⚡" (don't wait for the receipt — pool
 * queries are invalidated and reconcile themselves). Errors toast inline.
 *
 * Usage:
 *   toast.success("Stake submitted ⚡", { link: basescanUrl });
 *   toast.error("Approval failed", "Not enough TICK.");
 *
 * <ToastViewport /> is mounted once in the root layout.
 */

"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../lib/cn";

export interface ToastOptions {
  /** Optional tx explorer link shown under the message. */
  link?: string;
  /** Auto-dismiss after this many ms (default 5000; errors 8000). */
  duration?: number;
}

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  link?: string;
  leaving: boolean;
}

type Listener = (t: ToastItem) => void;

let nextId = 1;
const listeners = new Set<Listener>();

function emit(kind: ToastKind, message: string, detail?: string, opts?: ToastOptions) {
  const item: ToastItem = {
    id: nextId++,
    kind,
    message,
    detail,
    link: opts?.link,
    leaving: false,
  };
  listeners.forEach((l) => l(item));
}

export const toast = {
  success: (message: string, opts?: ToastOptions & { detail?: string }) =>
    emit("success", message, opts?.detail, opts),
  error: (message: string, detail?: string) => emit("error", message, detail, { duration: 8000 }),
  info: (message: string, opts?: ToastOptions & { detail?: string }) =>
    emit("info", message, opts?.detail, opts),
};

const KIND_STYLE: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: "border-emerald-500/30", iconColor: "text-emerald-500" },
  error: { icon: AlertTriangle, ring: "border-red-500/30", iconColor: "text-red-500" },
  info: { icon: Info, ring: "border-[#2E7CF6]/30", iconColor: "text-[#2E7CF6]" },
};

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const style = KIND_STYLE[item.kind];
  const Icon = style.icon;
  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      className={cn(
        "glass-strong pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border p-3.5 shadow-[0_16px_50px_rgba(0,0,0,.22)]",
        style.ring,
        item.leaving
          ? "translate-y-2 opacity-0"
          : "animate-page-in translate-y-0 opacity-100"
      )}
      style={{ transition: "transform .25s ease, opacity .25s ease" }}
    >
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", style.iconColor)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-zinc-900 dark:text-white">{item.message}</p>
        {item.detail && (
          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</p>
        )}
        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block text-[11px] font-bold text-[#2E7CF6] hover:underline"
          >
            View transaction ↗
          </a>
        )}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="rounded-full p-1 text-zinc-400 transition-colors hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (t) => {
      setItems((prev) => [...prev.slice(-3), t]);
      const duration = t.kind === "error" ? 8000 : 5000;
      window.setTimeout(() => dismiss(t.id), duration);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss(id: number) {
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 260);
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex flex-col items-end gap-2 sm:bottom-6 sm:right-6">
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
