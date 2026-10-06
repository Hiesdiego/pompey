/**
 * Header (spec P3.1 / P3.3): logo, nav, theme toggle, network indicator,
 * TICK balance + faucet button, Privy login/logout.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Copy,
  Check,
  Loader2,
  LogOut,
  ChevronDown,
  UserRound,
  Moon,
  Sun,
  Wallet,
} from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { useMyProfile } from "../hooks/useMyProfile";
import { useTickBalance } from "../hooks/useTickBalance";
import { useOpenClaimCount } from "../hooks/useOpenClaimCount";
import { useTheme } from "./ThemeProvider";
import { formatTick } from "../lib/format";
import { cn } from "../lib/cn";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/fixtures", label: "Fixtures" },
  { href: "/markets", label: "Markets" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/claims", label: "Claims" },
];

function ThemeToggle({ inMenu = false }: { inMenu?: boolean }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      className={cn(
        inMenu
          ? "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          : "flex h-9 w-9 items-center justify-center rounded-xl border transition-all active:scale-95",
        inMenu
          ? "text-zinc-700 dark:text-zinc-200"
          : "border-black/10 bg-white/60 text-zinc-600 hover:border-[#2E7CF6]/50 hover:text-[#2E7CF6] dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 dark:hover:border-[#2E7CF6]/50 dark:hover:text-[#4B93FF]"
      )}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      {inMenu && <span>{theme === "dark" ? "Light theme" : "Dark theme"}</span>}
    </button>
  );
}

function FaucetButton({ inMenu = false }: { inMenu?: boolean }) {
  const { playerAddress, authenticated } = useTickr();
  const { claimFaucet, faucetBusy, faucetError, faucetTx, balance, walletReady, nextFaucetClaimAt, faucetReady } =
    useTickBalance(playerAddress);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!nextFaucetClaimAt) return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [nextFaucetClaimAt]);
  const remaining = Math.max(0, (nextFaucetClaimAt ?? 0) - now);
  const countdown = `${Math.floor(remaining / 3600).toString().padStart(2, "0")}h ${Math.floor((remaining % 3600) / 60).toString().padStart(2, "0")}m ${(remaining % 60).toString().padStart(2, "0")}s`;

  // Auto-open the faucet popover once per session when the wallet has 0 TICK
  // — new users shouldn't have to discover the balance-pill dropdown.
  const autoOpenedRef = useRef(false);
  const tryAutoOpen = useCallback(() => {
    if (autoOpenedRef.current) return;
    if (!authenticated || !walletReady) return;
    if (inMenu) return;
    // The header trigger is hidden on mobile, so only auto-open its popover on desktop.
    if (!inMenu && window.matchMedia("(max-width: 767px)").matches) return;
    if (balance === null || balance > 0n) return;
    if (window.sessionStorage.getItem("tickr:faucet-auto-opened")) return;
    autoOpenedRef.current = true;
    window.sessionStorage.setItem("tickr:faucet-auto-opened", "1");
    setOpen(true);
  }, [authenticated, walletReady, balance, inMenu]);

  useEffect(() => {
    tryAutoOpen();
  }, [tryAutoOpen]);

  // OnboardingGate nudges us right after first-login profile creation —
  // the balance query may not have refreshed yet at that instant.
  useEffect(() => {
    const onProfileCreated = () => tryAutoOpen();
    window.addEventListener("tickr:profile-created", onProfileCreated);
    return () => window.removeEventListener("tickr:profile-created", onProfileCreated);
  }, [tryAutoOpen]);

  if (!authenticated) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          inMenu
            ? "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            : "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-display text-sm font-bold transition-all active:scale-95",
          inMenu
            ? "text-zinc-700 dark:text-zinc-200"
            : "border-[#2E7CF6]/30 bg-[#2E7CF6]/10 text-[#1D4ED8] hover:bg-[#2E7CF6]/20 dark:border-[#2E7CF6]/40 dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff] dark:hover:bg-[#2E7CF6]/25"
        )}
        title="TICK balance — click for faucet"
      >
        <Image
          src="/tickr-logo/v2-rising-t/tickr-token.svg"
          alt=""
          width={18}
          height={18}
          className="h-4 w-4 rounded-full"
        />
        <span className={cn(inMenu && "mr-auto ml-2")}>{inMenu ? "Balance" : null}</span>
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
              disabled={faucetBusy || !walletReady || !faucetReady}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-white transition-all active:scale-[.98]",
                faucetBusy || !faucetReady
                  ? "cursor-not-allowed bg-zinc-400 dark:bg-zinc-700"
                  : "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_20px_rgba(46,124,246,.4)] hover:shadow-[0_0_28px_rgba(46,124,246,.55)]"
              )}
            >
              {faucetBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {faucetBusy ? "Claiming…" : faucetReady ? "Claim 1,000 TICK" : `Available in ${countdown}`}
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

function WalletAddressButton() {
  const { playerAddress, authenticated, logout } = useTickr();
  const { profile } = useMyProfile();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  if (!authenticated) return null;

  async function copyAddress() {
    try {
      if (!playerAddress) return;
      await navigator.clipboard.writeText(playerAddress);
      setCopied(true);
      setCopyError(null);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError("Could not copy the address. Try selecting it manually.");
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex max-w-44 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors",
          "border-black/10 bg-white/50 text-zinc-700 hover:border-[#2E7CF6]/40 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200"
        )}
        title="Account menu"
        aria-label="Open account menu"
        aria-expanded={open}
      >
        <span className="truncate">{profile?.username ? `@${profile.username}` : "Account"}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="glass-strong absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl p-3 shadow-xl">
            {playerAddress && <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[.14em] text-zinc-500 dark:text-zinc-400">Wallet address</p>
              <p className="break-all rounded-lg bg-black/5 p-2.5 font-mono text-xs text-zinc-800 dark:bg-white/5 dark:text-zinc-200">{playerAddress}</p>
              <button
                onClick={copyAddress}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/5 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4 text-[#2E7CF6]" />}
                {copied ? "Address copied" : "Copy address"}
              </button>
            </>}
            {profile?.username && (
              <Link
                href={`/${encodeURIComponent(profile.username)}`}
                onClick={() => setOpen(false)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-black/10 px-3 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-black/5 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/5"
              >
                <UserRound className="h-4 w-4 text-[#2E7CF6]" /> View profile
              </Link>
            )}
            <div className="my-2 border-t border-black/5 dark:border-white/10 md:hidden" />
            <div className="space-y-1 md:hidden">
              <FaucetButton inMenu />
              <ThemeToggle inMenu />
            </div>
            {copyError && <p className="mt-2 text-xs text-amber-600">{copyError}</p>}
            <div className="my-2 border-t border-black/5 dark:border-white/10" />
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function Header() {
  const { ready, authenticated, login, walletLoading } = useTickr();
  const pathname = usePathname();
  const openClaimCount = useOpenClaimCount();

  return (
    <header className="glass-strong sticky top-0 z-40 !border-x-0 !border-t-0">
      <div className="mx-auto flex h-16 min-w-0 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3 md:gap-6">
          <Link href="/" aria-label="TICKR home" className="group flex shrink-0 items-center gap-2">
            <Image
              src="/tickr-logo/v2-rising-t/tickr-wordmark-dark.svg"
              alt="TICKR"
              width={172}
              height={90}
              priority
              className="h-10 w-auto transition-transform group-hover:scale-[1.02] dark:hidden"
            />
            <Image
              src="/tickr-logo/v2-rising-t/tickr-wordmark-light.svg"
              alt=""
              width={172}
              height={90}
              aria-hidden="true"
              priority
              className="hidden h-10 w-auto transition-transform group-hover:scale-[1.02] dark:block"
            />
            <span className="rounded-md bg-[#2E7CF6]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#2E7CF6] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]">
              BETA
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
                {n.href === "/claims" && authenticated && openClaimCount > 0 && (
                  <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold leading-4 text-white" aria-label={`${openClaimCount} open claims`}>
                    {openClaimCount > 99 ? "99+" : openClaimCount}
                  </span>
                )}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden md:block"><FaucetButton /></div>
          <div className="hidden md:block"><ThemeToggle /></div>
          {authenticated && walletLoading && (
            <span
              role="status"
              aria-live="polite"
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#2E7CF6]/20 bg-[#2E7CF6]/[.06] px-2 py-1.5 text-xs font-semibold text-zinc-600 dark:text-zinc-300 sm:px-2.5"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2E7CF6]" />
              <span className="max-[400px]:hidden">Loading wallet…</span>
            </span>
          )}
          {!ready ? (
            <span className="text-xs text-zinc-500">…</span>
          ) : authenticated ? (
            <WalletAddressButton />
          ) : (
            <button
              onClick={login}
              className="gradient-cta flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-bold active:scale-[.97]"
            >
              <Wallet className="h-4 w-4" />
              Sign in
            </button>
          )}
        </div>
      </div>
      {/* Mobile nav */}
      <nav className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain border-t border-black/5 px-4 py-1.5 md:hidden dark:border-white/5">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-3 py-1 text-sm font-medium transition-colors",
              pathname === n.href
                ? "bg-[#2E7CF6]/12 text-[#1D4ED8] dark:bg-[#2E7CF6]/15 dark:text-[#7db3ff]"
                : "text-zinc-500 dark:text-zinc-400"
              )}
            >
              {n.label}
              {n.href === "/claims" && authenticated && openClaimCount > 0 && (
                <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-extrabold leading-4 text-white" aria-label={`${openClaimCount} open claims`}>
                  {openClaimCount > 99 ? "99+" : openClaimCount}
                </span>
              )}
            </Link>
        ))}
      </nav>
    </header>
  );
}
