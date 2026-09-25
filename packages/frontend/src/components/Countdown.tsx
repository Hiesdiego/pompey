/**
 * Countdown timer hook + component.
 */

"use client";

import { useEffect, useState } from "react";
import { countdownParts } from "../lib/format";

export function useCountdown(targetMs: number | null, tickMs = 1000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (targetMs === null) return;
    const t = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(t);
  }, [targetMs, tickMs]);

  if (targetMs === null) return { remaining: null as number | null, expired: false, parts: null };
  const remaining = targetMs - now;
  return {
    remaining,
    expired: remaining <= 0,
    parts: countdownParts(remaining),
  };
}

/** Compact "04:12:33" style countdown; renders "—" when target is null. */
export function Countdown({
  target,
  className = "",
}: {
  target: number | null;
  className?: string;
}) {
  const { remaining, expired, parts } = useCountdown(target);
  if (target === null || parts === null) return <span className={className}>—</span>;
  if (expired) return <span className={className}>00:00</span>;
  const pad = (n: number) => String(n).padStart(2, "0");
  const text =
    parts.d > 0
      ? `${parts.d}d ${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}`
      : parts.h > 0
        ? `${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}`
        : `${pad(parts.m)}:${pad(parts.s)}`;
  return <span className={className}>{text}</span>;
}
