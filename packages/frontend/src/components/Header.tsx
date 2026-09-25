/**
 * Header (spec P3.1 / P3.3): logo, nav, theme toggle, network indicator,
 * TICK balance + faucet button, Privy login/logout.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Droplets,
  Loader2,
  LogOut,
  Moon,
  Sun,
  Wallet,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { useTickBalance } from "../hooks/useTickBalance";
import { useTheme } from "./ThemeProvider";
import { ACTIVE_CHAIN_NAME } from "../lib/contracts";
import { formatTick } from "../lib/format";
import { cn } from "../lib/cn";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/claims", label: "Claims" },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95",
        "border-black/10 bg-white/60 text-zinc-600 hover:border-[#2E7CF6]/50 hover:text-[#2E7CF6]",
        "dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 dark:hover:border-[#2E7CF6]/50 dark:hover:text-[#4B93FF]"
      )}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function FaucetButton() {
  const { playerAddress, authenticated } = useTickr();
  const { claimFaucet, faucetBusy, faucetError, faucetTx, balance } =
    useTickBalance(playerAddress);
  const [open, setOpen] = useState(false);

  if (!authenticated) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-display text-sm font-bold transition-all active:scale-95",
          "border-[#2E7CF6]/30 bg-[#2E7CF6]/10 text-[#1D4ED8] hover:bg-[#2E7CF6]/20",
          "dark:border-[#2E7CF6]/40 dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff] dark:hover:bg-[#2E7CF6]/25"
        )}
        title="TICK balance — click for faucet"
      >
        <Droplets className="h-4 w-4" />
        <span className="tabular-nums">{balance === null ? "—" : formatTick(balance, 0)}</span>
        <span className="text-[10px] font-semibold">TICK</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass-strong absolute right-0 z-50 mt-2 w-64 animate-page-in rounded-2xl p-4">
            <p className="mb-1 font-display text-sm font-bold text-zinc-900 dark:text-white">
              Testnet faucet
            </p>
            <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
              Claim 1,000 free TICK once per day to stake with.
            </p>
            <button
              onClick={claimFaucet}
              disabled={faucetBusy}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all active:scale-[.98]",
                faucetBusy
                  ? "cursor-not-allowed bg-zinc-400 dark:bg-zinc-700"
                  : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_20px_rgba(46,124,246,.4)] hover:shadow-[0_0_28px_rgba(46,124,246,.55)]"
              )}
            >
              {faucetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {faucetBusy ? "Claiming…" : "Claim 1,000 TICK"}
            </button>
            {faucetError && (
              <p className="mt-2 text-xs text-red-500 dark:text-red-300">{faucetError}</p>
            )}
            {faucetTx && (
              <p className="mt-2 text-xs text-[#1D4ED8] dark:text-[#7db3ff]">
                Claimed! <span className="font-mono">{faucetTx.slice(0, 12)}…</span>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function NetworkBadge() {
  const { chainStatus, ensureChain, authenticated } = useTickr();
  if (!authenticated) return null;
  const ok = chainStatus === "correct" || chainStatus === "unknown";
  return (
    <button
      onClick={() => {
        if (chainStatus === "failed") ensureChain();
      }}
      title={
        chainStatus === "failed"
          ? "Click to switch to the TICKR network"
          : `Connected network: ${ACTIVE_CHAIN_NAME}`
      }
      className={cn(
        "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors sm:inline-flex",
        chainStatus === "failed"
          ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-300"
          : "bg-black/5 text-zinc-500 dark:bg-white/5 dark:text-zinc-400"
      )}
    >
      {chainStatus === "switching" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : ok ? (
        <Wifi className="h-3 w-3 text-[#2E7CF6]" />
      ) : (
        <WifiOff className="h-3 w-3" />
      )}
      {ACTIVE_CHAIN_NAME}
      {chainStatus === "failed" && " — switch"}
    </button>
  );
}

export function Header() {
  const { ready, authenticated, login, logout, privyUserId } = useTickr();
  const pathname = usePathname();

  return (
    <header className="glass-strong sticky top-0 z-40 !border-x-0 !border-t-0">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="group flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] font-display text-sm font-bold text-white shadow-[0_0_18px_rgba(46,124,246,.45)] transition-shadow group-hover:shadow-[0_0_26px_rgba(46,124,246,.65)]">
              T
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-zinc-900 dark:text-white">
              TICKR
              <span className="ml-1.5 rounded-md bg-[#2E7CF6]/10 px-1.5 py-0.5 align-middle text-[10px] font-bold text-[#2E7CF6] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
                BETA
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-sm font-medium transition-all",
                  pathname === n.href
                    ? "bg-[#2E7CF6]/12 text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]"
                    : "text-zinc-500 hover:bg-black/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100"
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <NetworkBadge />
          <FaucetButton />
          <ThemeToggle />
          {!ready ? (
            <span className="text-xs text-zinc-500">…</span>
          ) : authenticated ? (
            <button
              onClick={logout}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition-all active:scale-95",
                "border-black/10 text-zinc-600 hover:border-black/25",
                "dark:border-white/10 dark:text-zinc-300 dark:hover:border-white/25"
              )}
              title={privyUserId ?? "Signed in"}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <button
              onClick={login}
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] px-4 py-1.5 text-sm font-bold text-white shadow-[0_0_20px_rgba(46,124,246,.4)] transition-all hover:shadow-[0_0_28px_rgba(46,124,246,.55)] active:scale-[.97]"
            >
              <Wallet className="h-4 w-4" />
              Sign in
            </button>
          )}
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-black/5 px-4 py-1.5 md:hidden dark:border-white/5">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium transition-colors",
              pathname === n.href
                ? "bg-[#2E7CF6]/12 text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]"
                : "text-zinc-500 dark:text-zinc-400"
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
