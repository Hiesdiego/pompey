"use client";

import { useCallback, useEffect, useState } from "react";
import { useTickr } from "../hooks/useTickr";

export interface WatchEntry {
  marketId: string;
  expiresAt?: number;
  nearTarget: boolean;
  closing: boolean;
  settled: boolean;
}

export interface WatchNotice {
  key: string;
  marketId: string;
  message: string;
  at: number;
}

const eventName = "tickr-watchlist-change";
const keyFor = (wallet: string) => `tickr-watchlist-v1:${wallet.toLowerCase()}`;
const noticeKeyFor = (wallet: string) => `tickr-watch-notices-v1:${wallet.toLowerCase()}`;
const WATCH_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

export function readWatchlist(wallet: string): WatchEntry[] {
  const entries = read<WatchEntry>(keyFor(wallet));
  const now = Date.now();
  const active = entries.filter((entry) => !entry.expiresAt || entry.expiresAt > now)
    .map((entry) => entry.expiresAt ? entry : { ...entry, expiresAt: now + WATCH_LIFETIME_MS });
  if (typeof window !== "undefined" && (active.length !== entries.length || entries.some((entry) => !entry.expiresAt))) {
    localStorage.setItem(keyFor(wallet), JSON.stringify(active));
  }
  return active;
}
export function readWatchNotices(wallet: string): WatchNotice[] { return read<WatchNotice>(noticeKeyFor(wallet)); }

export function saveWatchlist(wallet: string, entries: WatchEntry[]) {
  localStorage.setItem(keyFor(wallet), JSON.stringify(entries));
  window.dispatchEvent(new Event(eventName));
}

export function saveWatchNotice(wallet: string, notice: WatchNotice) {
  const existing = readWatchNotices(wallet);
  if (existing.some((n) => n.key === notice.key)) return false;
  localStorage.setItem(noticeKeyFor(wallet), JSON.stringify([notice, ...existing].slice(0, 50)));
  window.dispatchEvent(new Event(eventName));
  return true;
}

export function useWatchlist() {
  const { playerAddress } = useTickr();
  const wallet = playerAddress?.toLowerCase() ?? "";
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [notices, setNotices] = useState<WatchNotice[]>([]);

  useEffect(() => {
    const update = () => {
      setEntries(wallet ? readWatchlist(wallet) : []);
      setNotices(wallet ? readWatchNotices(wallet) : []);
    };
    update();
    const timer = window.setInterval(update, 60 * 60_000);
    window.addEventListener(eventName, update);
    window.addEventListener("storage", update);
    return () => { window.clearInterval(timer); window.removeEventListener(eventName, update); window.removeEventListener("storage", update); };
  }, [wallet]);

  const toggle = useCallback((marketId: string) => {
    if (!wallet) return;
    const old = readWatchlist(wallet);
    saveWatchlist(wallet, old.some((e) => e.marketId === marketId)
      ? old.filter((e) => e.marketId !== marketId)
      : [...old, { marketId, nearTarget: true, closing: true, settled: true, expiresAt: Date.now() + WATCH_LIFETIME_MS }]);
  }, [wallet]);

  const setAlert = useCallback((marketId: string, field: "nearTarget" | "closing" | "settled", enabled: boolean) => {
    if (!wallet) return;
    saveWatchlist(wallet, readWatchlist(wallet).map((entry) => entry.marketId === marketId ? { ...entry, [field]: enabled } : entry));
  }, [wallet]);

  return { wallet, entries, notices, toggle, setAlert };
}
