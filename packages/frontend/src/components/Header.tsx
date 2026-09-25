/**
 * Header (spec P3.1 / P3.3): logo, nav, network indicator + manual switch,
 * TICK balance + faucet button, Privy login/logout.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Droplets, Loader2, LogOut, Wallet, Wifi, WifiOff } from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { useTickBalance } from "../hooks/useTickBalance";
import { ACTIVE_CHAIN_NAME } from "../lib/contracts";
import { formatTick } from "../lib/format";
import { cn } from "../lib/cn";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/claims", label: "Claims" },
];

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
        className="flex items-center gap-1.5 rounded-xl border border-[#1D9E75]/40 bg-[#1D9E75]/10 px-3 py-1.5 text-sm font-bold text-[#9fe8cd] hover:bg-[#1D9E75]/20"
        title="TICK balance — click for faucet"
      >
        <Droplets className="h-4 w-4" />
        {balance === null ? "—" : formatTick(balance, 0)}
        <span className="text-[10px] font-semibold">TICK</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-2xl border border-zinc-700 bg-[#1a1a1d] p-4 shadow-xl">
            <p className="mb-1 text-sm font-bold text-white">Testnet faucet</p>
            <p className="mb-3 text-xs text-zinc-400">
              Claim 1,000 free TICK once per day to stake with.
            </p>
            <button
              onClick={claimFaucet}
              disabled={faucetBusy}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white",
                faucetBusy ? "cursor-not-allowed bg-zinc-700" : "bg-[#1D9E75] hover:bg-[#178a64]"
              )}
            >
              {faucetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {faucetBusy ? "Claiming…" : "Claim 1,000 TICK"}
            </button>
            {faucetError && (
              <p className="mt-2 text-xs text-red-300">{faucetError}</p>
            )}
            {faucetTx && (
              <p className="mt-2 text-xs text-[#1D9E75]">
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
        "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex",
        chainStatus === "failed"
          ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
          : "bg-zinc-800 text-zinc-400"
      )}
    >
      {chainStatus === "switching" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : ok ? (
        <Wifi className="h-3 w-3 text-[#1D9E75]" />
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
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#0b0b0d]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#7F77DD] to-[#1D9E75] text-sm font-black text-white">
              T
            </span>
            <span className="text-lg font-black tracking-tight text-white">
              TICKR
              <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 align-middle text-[10px] font-bold text-zinc-400">
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
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname === n.href
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
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
          {!ready ? (
            <span className="text-xs text-zinc-500">…</span>
          ) : authenticated ? (
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-xl border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-300 hover:border-zinc-500"
              title={privyUserId ?? "Signed in"}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          ) : (
            <button
              onClick={login}
              className="flex items-center gap-1.5 rounded-xl bg-[#7F77DD] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#6f68d6]"
            >
              <Wallet className="h-4 w-4" />
              Sign in
            </button>
          )}
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-zinc-800/60 px-4 py-1.5 md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium",
              pathname === n.href ? "bg-zinc-800 text-white" : "text-zinc-400"
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
