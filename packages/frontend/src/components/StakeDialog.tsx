"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

/** Viewport anchored shell shared by quick, match, and market stake forms. */
export function StakeDialog({
  title,
  size = "md",
  onClose,
  onReady,
  children,
}: {
  title: string;
  size?: "md" | "lg";
  onClose: () => void;
  onReady?: () => void;
  children: ReactNode;
}) {
  const [portalReady, setPortalReady] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setPortalReady(true);
    const frame = requestAnimationFrame(() => onReady?.());
    return () => cancelAnimationFrame(frame);
  }, [onReady]);

  useEffect(() => {
    if (!portalReady) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [portalReady]);

  if (!portalReady) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="stake-dialog-backdrop absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => closeRef.current()} />
      <div
        ref={panelRef}
        className={cn(
          "stake-dialog-panel relative z-10 max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-[1.75rem] border border-black/10 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-zinc-900 shadow-[0_28px_100px_rgba(0,0,0,.45)] dark:border-white/10 dark:bg-[#101722] dark:text-white sm:max-h-[88dvh] sm:rounded-[1.5rem] sm:p-6",
          size === "lg" ? "sm:max-w-lg" : "sm:max-w-md"
        )}
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-white/20 sm:hidden" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body
  );
}
