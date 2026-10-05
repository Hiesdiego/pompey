"use client";

import Link from "next/link";
import { Bell, BellOff } from "lucide-react";
import { useWatchlist } from "../lib/watchlist";

export function WatchButton({ marketId }: { marketId: string }) {
  const { wallet, entries, toggle } = useWatchlist();
  if (!wallet) return <Link href="/watchlist" className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-bold dark:border-white/10"><Bell className="h-4 w-4" /> Watch</Link>;
  const watched = entries.some((e) => e.marketId === marketId);
  return <button type="button" onClick={() => toggle(marketId)} aria-pressed={watched} className="inline-flex items-center gap-2 rounded-full border border-black/10 px-3 py-2 text-xs font-bold transition hover:border-[#2E7CF6]/60 dark:border-white/10">{watched ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}{watched ? "Watching" : "Watch"}</button>;
}
