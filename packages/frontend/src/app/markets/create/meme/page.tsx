"use client";

/**
 * Create a meme clash.
 *
 * Target location in the repo:
 *   packages/frontend/src/app/markets/create/meme/page.tsx
 *
 * Mirrors the create flow structure and style on main precisely:
 * back link, header band, picker list on the left, preview aside on
 * the right, seed and balance logic, and the approve plus create
 * batch. On main the stock template is wired inside
 * app/markets/create/page.tsx as the stock branch of the price target
 * template, and the step 1 template grid on that page links here, so
 * this page follows that page's band, card and aside styling.
 * Differences are the Arena terms only:
 * the picker is the dynamic BaseStonk registry, the opponent defaults
 * to the paired stock with a derby option against another meme on the
 * same paired stock, and the window is 24 hours or a 1 hour blitz.
 * cupTie is always false from the UI, cup ties are seeded by the
 * backend seeder, never by hand. Search also queries the full
 * BaseStonk catalogue through the backend registry search, so memes
 * outside the local registry list can be picked and used as derby
 * opponents, and every picker row carries a pair badge naming what
 * the meme is paired with (a stock, USDC, WETH or another token),
 * with pair filter chips above the list.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { ArrowLeft, Search, Swords } from "lucide-react";
import { useTickr } from "../../../../hooks/useTickr";
import { useTickBalance } from "../../../../lib/query/useTickBalance";
import { useMyProfile } from "../../../../hooks/useMyProfile";
import { useContractWrite } from "../../../../hooks/useContractWrite";
import { getPublicClient } from "../../../../hooks/usePublicClient";
import { CONTRACTS, TICK_TOKEN_ABI } from "../../../../lib/contracts";
import {
  ARENA_CLASH_FACTORY_ADDRESS,
  ARENA_CREATION_SEED_TICK,
  ARENA_WINDOW_BLITZ_SECONDS,
  ARENA_WINDOW_STANDARD_SECONDS,
  MEME_CLASH_FACTORY_ABI,
  arenaClashQuestion,
  arenaDisplaySymbol,
  opponentKindCode,
  type RegistryMeme,
} from "../../../../lib/arenaContracts";
import { useArenaRegistry, useArenaRegistrySearch } from "../../../../lib/query/useArena";
import { qks } from "../../../../lib/query/keys";
import { queryClient } from "../../../../lib/query/queryClient";
import { MemeLogo } from "../../../../components/MemeLogo";
import { StockLogo } from "../../../../components/StockLogo";
import { toast } from "../../../../components/Toast";

function usdLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pairBadgeLabel(meme: RegistryMeme): string {
  if (meme.pairType === "stock") {
    return meme.pairedStock
      ? `Paired with ${arenaDisplaySymbol(meme.pairedStock.symbol)}`
      : "Stock pair";
  }
  if (meme.pairType === "usdc") return "USDC pair";
  if (meme.pairType === "weth") return "WETH pair";
  return meme.pairSymbol ? `${arenaDisplaySymbol(meme.pairSymbol)} pair` : "Other pair";
}

export default function MemeClashCreatePage() {
  const router = useRouter();
  const { playerAddress, authenticated, login } = useTickr();
  const { balance } = useTickBalance(playerAddress ?? null);
  const { profile } = useMyProfile();
  const { write, writeBatch, pending } = useContractWrite();
  const registryQuery = useArenaRegistry();
  const memes = useMemo(() => registryQuery.data?.memes ?? [], [registryQuery.data]);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const registrySearchQuery = useArenaRegistrySearch(debouncedSearch);
  const searchMemes = useMemo(
    () => registrySearchQuery.data?.memes ?? [],
    [registrySearchQuery.data]
  );

  // Merged universe: the local registry plus catalogue search results,
  // deduped by lowercase address. Registry entries are added first, so
  // a local entry wins when the same meme appears in both lists.
  const allMemes = useMemo(() => {
    const byAddress = new Map<string, RegistryMeme>();
    for (const meme of memes) byAddress.set(meme.address.toLowerCase(), meme);
    for (const meme of searchMemes) {
      const key = meme.address.toLowerCase();
      if (!byAddress.has(key)) byAddress.set(key, meme);
    }
    return [...byAddress.values()];
  }, [memes, searchMemes]);

  const [pairFilter, setPairFilter] = useState<"all" | "stock" | "crypto">("all");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [opponentMode, setOpponentMode] = useState<"stock" | "derby">("stock");
  const [derbyAddress, setDerbyAddress] = useState("");
  const [windowDuration, setWindowDuration] = useState<number>(ARENA_WINDOW_STANDARD_SECONDS);
  const [creatorName, setCreatorName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selected: RegistryMeme | undefined = allMemes.find(
    (meme) => meme.address.toLowerCase() === selectedAddress.toLowerCase()
  );

  const derbyOptions = useMemo(() => {
    if (!selected?.pairToken) return [];
    return allMemes.filter(
      (meme) =>
        meme.address.toLowerCase() !== selected.address.toLowerCase() &&
        meme.pairToken !== null &&
        meme.pairToken.toLowerCase() === selected.pairToken!.toLowerCase()
    );
  }, [allMemes, selected]);

  const derbyOpponent: RegistryMeme | undefined = derbyOptions.find(
    (meme) => meme.address.toLowerCase() === derbyAddress.toLowerCase()
  );

  // A meme with no paired stock can only play a derby. A meme with no
  // paired stock and no derby opponent cannot be selected at all.
  const selectable = (meme: RegistryMeme): { ok: boolean; reason: string | null } => {
    if (!meme.creationEnabled) return { ok: false, reason: meme.disableReason ?? "Creation is off for this meme" };
    if (meme.pairedStock) return { ok: true, reason: null };
    const hasDerby = allMemes.some(
      (other) =>
        other.address.toLowerCase() !== meme.address.toLowerCase() &&
        other.pairToken !== null &&
        meme.pairToken !== null &&
        other.pairToken.toLowerCase() === meme.pairToken.toLowerCase()
    );
    if (hasDerby) return { ok: true, reason: null };
    return { ok: false, reason: "No paired stock and no derby opponent yet" };
  };

  const filtered = useMemo(
    () =>
      allMemes
        .filter((meme) => `${meme.name} ${meme.symbol}`.toLowerCase().includes(search.trim().toLowerCase()))
        .filter((meme) => {
          if (pairFilter === "stock") return meme.pairType === "stock";
          if (pairFilter === "crypto") return meme.pairType !== "stock";
          return true;
        })
        .slice(0, 50),
    [allMemes, search, pairFilter]
  );

  const searchingCatalogue =
    registrySearchQuery.isFetching && search.trim().length >= 2;

  const effectiveMode: "stock" | "derby" = selected?.pairedStock ? opponentMode : "derby";
  const opponentToken =
    effectiveMode === "stock"
      ? (selected?.pairedStock?.address ?? "")
      : (derbyOpponent?.address ?? "");
  const opponentSymbol =
    effectiveMode === "stock"
      ? (selected?.pairedStock?.symbol ?? "")
      : (derbyOpponent?.symbol ?? "");
  const opponentKind = effectiveMode === "stock" ? ("stock" as const) : ("meme" as const);
  const opponentReady = Boolean(selected && opponentToken && opponentSymbol);

  const enoughBalance =
    balance === null || balance >= BigInt(ARENA_CREATION_SEED_TICK) * 10n ** 18n;
  const ready = Boolean(
    playerAddress &&
      selected &&
      selectable(selected).ok &&
      opponentReady &&
      (creatorName.trim() || profile?.username) &&
      enoughBalance &&
      ARENA_CLASH_FACTORY_ADDRESS
  );
  const preview =
    selected && opponentReady
      ? arenaClashQuestion(selected.symbol, opponentSymbol, opponentKind, windowDuration)
      : "Choose a meme and an opponent to preview your question.";

  function pickMeme(meme: RegistryMeme) {
    setSelectedAddress(meme.address);
    setDerbyAddress("");
    setOpponentMode(meme.pairedStock ? "stock" : "derby");
  }

  async function create() {
    if (!playerAddress || !selected || !ready) return;
    setError(null);
    const seed = BigInt(ARENA_CREATION_SEED_TICK) * 10n ** 18n;
    const client = getPublicClient();
    const factory = ARENA_CLASH_FACTORY_ADDRESS as Address;
    const tickToken = CONTRACTS.tickToken as Address;
    try {
      const allowance = await client.readContract({
        address: tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "allowance",
        args: [playerAddress, factory],
      });
      const approve = {
        address: tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "approve",
        args: [factory, seed],
        label: "TICK seed approval",
      };
      const createCall = {
        address: factory,
        abi: MEME_CLASH_FACTORY_ABI,
        functionName: "createClash",
        args: [
          selected.address as `0x${string}`,
          selected.symbol,
          opponentKindCode(opponentKind),
          opponentToken as `0x${string}`,
          opponentSymbol,
          BigInt(windowDuration),
          false,
          (profile?.username || creatorName).slice(0, 32),
        ],
        label: "Create meme clash",
      };
      if (allowance < seed) await writeBatch([approve, createCall], { label: "Approve and create meme clash" });
      else await write(createCall);
      toast.success("Meme clash created", { detail: `${ARENA_CREATION_SEED_TICK} TICK seed added to the pool` });
      void queryClient.invalidateQueries({ queryKey: qks.arenaClashes });
      router.push("/markets");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create this clash.");
    }
  }

  if (!ARENA_CLASH_FACTORY_ADDRESS)
    return (
      <main className="mx-auto max-w-3xl py-12">
        <Link href="/markets/create" className="text-sm font-semibold text-[#2E7CF6]">← Other market formats</Link>
        <div className="surface-card mt-5 rounded-3xl p-8">
          <h1 className="font-display text-2xl font-black">Meme clashes are not deployed yet</h1>
          <p className="mt-2 text-sm text-zinc-500">The meme clash factory must be deployed and configured before clashes can be created.</p>
        </div>
      </main>
    );

  return (
    <main className="mx-auto max-w-6xl pb-16">
      <Link href="/markets/create" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-[#2E7CF6]">
        <ArrowLeft className="h-4 w-4" /> Other market formats
      </Link>
      <header className="relative mb-8 overflow-hidden rounded-[2rem] bg-[#0d224b] p-7 text-white sm:p-10">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#2E7CF6]/40 blur-3xl" />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[.2em] text-[#93c0ff]">
            <Swords className="h-4 w-4" /> Meme clashes
          </p>
          <h1 className="mt-3 max-w-2xl font-display text-4xl font-black leading-tight sm:text-5xl">Back the meme. Beat the stock.</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-white/70">
            Choose a BaseStonk meme and ask whether it will outperform its paired stock, or another meme on the same stock. The window starts 1 hour after creation. Creating a clash adds a {ARENA_CREATION_SEED_TICK} TICK seed to its pool.
          </p>
        </div>
      </header>
      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="surface-card rounded-3xl p-5 sm:p-7">
          <label className="text-sm font-bold">Choose a meme</label>
          <p className="mt-1 text-xs text-zinc-500">Memes below the liquidity floor (default 5,000 USD) stay listed but are disabled, with the reason shown on the row.</p>
          <div className="relative mt-2">
            <Search className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search meme name or symbol" className="w-full rounded-xl border border-black/10 bg-transparent py-3 pl-10 pr-3 outline-none focus:border-[#2E7CF6] dark:border-white/10" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                { value: "all", label: "All pairs" },
                { value: "stock", label: "Stock-paired" },
                { value: "crypto", label: "Crypto-paired" },
              ] as const
            ).map((chip) => (
              <button
                key={chip.value}
                type="button"
                onClick={() => setPairFilter(chip.value)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-bold ${pairFilter === chip.value ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="mt-3 max-h-64 divide-y divide-black/[.06] overflow-y-auto rounded-xl border border-black/[.06] dark:divide-white/[.07] dark:border-white/[.07]">
            {registryQuery.isPending ? (
              <p className="p-4 text-sm text-zinc-500">Loading BaseStonk memes…</p>
            ) : filtered.length === 0 && searchingCatalogue ? (
              <p className="p-4 text-sm text-zinc-500">Searching all BaseStonk memes…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-zinc-500">No memes match your search.</p>
            ) : (
              filtered.map((meme) => {
                const gate = selectable(meme);
                return (
                  <button
                    key={meme.address}
                    type="button"
                    disabled={!gate.ok}
                    onClick={() => pickMeme(meme)}
                    className={`flex w-full items-center gap-3 p-3 text-left ${selectedAddress.toLowerCase() === meme.address.toLowerCase() ? "bg-[#2E7CF6]/[.07]" : "hover:bg-black/[.03] dark:hover:bg-white/[.03]"} disabled:cursor-not-allowed disabled:opacity-45`}
                  >
                    <MemeLogo symbol={meme.symbol} logoUrl={meme.logoUrl} imageUrl={meme.imageUrl} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {meme.name} <span className="text-zinc-500">({arenaDisplaySymbol(meme.symbol)})</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                        <span className="rounded-full bg-[#2E7CF6]/10 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#2E7CF6]">
                          {pairBadgeLabel(meme)}
                        </span>
                        <span>
                          {meme.pairedStock ? `Paired stock: ${arenaDisplaySymbol(meme.pairedStock.symbol)}` : "No paired stock"} · Liquidity {usdLabel(meme.liquidityUsd)} · 24h volume {usdLabel(meme.volume24hUsd)}
                        </span>
                      </span>
                      {!gate.ok && <span className="block text-xs text-amber-600 dark:text-amber-400">{gate.reason}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selected && (
            <div className="mt-6 grid gap-5">
              <fieldset>
                <legend className="text-sm font-bold">Opponent</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!selected.pairedStock}
                    onClick={() => setOpponentMode("stock")}
                    className={`rounded-xl border p-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${effectiveMode === "stock" ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}
                  >
                    {selected.pairedStock ? `Paired stock, ${arenaDisplaySymbol(selected.pairedStock.symbol)}` : "No paired stock"}
                  </button>
                  <button
                    type="button"
                    disabled={derbyOptions.length === 0}
                    onClick={() => setOpponentMode("derby")}
                    className={`rounded-xl border p-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 ${effectiveMode === "derby" ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}
                  >
                    Derby, another meme
                  </button>
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  {selected.pairType === "usdc"
                    ? "This meme is paired with USDC, not a stock, so it has no stock opponent. Only a derby against another meme applies."
                    : selected.pairType === "weth"
                      ? "This meme is paired with WETH, not a stock, so it has no stock opponent. Only a derby against another meme applies."
                      : selected.pairType === "other"
                        ? selected.pairSymbol
                          ? `This meme is paired with ${arenaDisplaySymbol(selected.pairSymbol)}, not a stock, so it has no stock opponent. Only a derby against another meme applies.`
                          : "This meme is not paired with a stock, so it has no stock opponent. Only a derby against another meme applies."
                        : selected.pairedStock
                          ? "The paired stock is the default opponent. A derby pits this meme against another meme launched on the same stock."
                          : "This meme has no paired stock, so a derby is the only mode."}
                </p>
                {effectiveMode === "stock" && selected.pairedStock && (
                  <div className="mt-3 flex items-center gap-3 rounded-xl border border-black/[.06] p-3 dark:border-white/[.07]">
                    <StockLogo symbol={selected.pairedStock.symbol} size={36} />
                    <span className="text-sm">
                      <span className="block font-bold">{selected.pairedStock.name}</span>
                      <span className="block text-xs text-zinc-500">{arenaDisplaySymbol(selected.pairedStock.symbol)} · Price source: Coinbase NAV</span>
                    </span>
                  </div>
                )}
                {effectiveMode === "derby" && (
                  <div className="mt-3 max-h-48 divide-y divide-black/[.06] overflow-y-auto rounded-xl border border-black/[.06] dark:divide-white/[.07] dark:border-white/[.07]">
                    {derbyOptions.length === 0 ? (
                      <p className="p-3 text-sm text-zinc-500">No other meme shares this paired stock yet, so no derby is available.</p>
                    ) : (
                      derbyOptions.map((meme) => (
                        <button
                          key={meme.address}
                          type="button"
                          onClick={() => setDerbyAddress(meme.address)}
                          className={`flex w-full items-center gap-3 p-3 text-left ${derbyAddress.toLowerCase() === meme.address.toLowerCase() ? "bg-[#2E7CF6]/[.07]" : "hover:bg-black/[.03] dark:hover:bg-white/[.03]"}`}
                        >
                          <MemeLogo symbol={meme.symbol} logoUrl={meme.logoUrl} imageUrl={meme.imageUrl} size={32} />
                          <span className="min-w-0 flex-1 text-sm">
                            <span className="block truncate font-bold">{meme.name} <span className="text-zinc-500">({arenaDisplaySymbol(meme.symbol)})</span></span>
                            <span className="block text-xs text-zinc-500">Liquidity {usdLabel(meme.liquidityUsd)} · 24h volume {usdLabel(meme.volume24hUsd)}</span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </fieldset>

              <fieldset>
                <legend className="text-sm font-bold">Window</legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWindowDuration(ARENA_WINDOW_STANDARD_SECONDS)}
                    className={`rounded-xl border p-3 text-sm font-bold ${windowDuration === ARENA_WINDOW_STANDARD_SECONDS ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}
                  >
                    24 hours
                  </button>
                  <button
                    type="button"
                    onClick={() => setWindowDuration(ARENA_WINDOW_BLITZ_SECONDS)}
                    className={`rounded-xl border p-3 text-sm font-bold ${windowDuration === ARENA_WINDOW_BLITZ_SECONDS ? "border-[#2E7CF6] bg-[#2E7CF6]/10 text-[#2E7CF6]" : "border-black/10 dark:border-white/10"}`}
                  >
                    1 hour blitz
                  </button>
                </div>
                <p className="mt-2 text-xs text-zinc-500">Staking closes at window start, 1 hour after creation. Yes wins only on a strictly greater percent move. An exact tie is No.</p>
              </fieldset>
            </div>
          )}

          {!profile?.username && (
            <label className="mt-5 block text-sm font-bold">
              Display name
              <input value={creatorName} onChange={(event) => setCreatorName(event.target.value.slice(0, 32))} className="mt-2 block w-full rounded-xl border border-black/10 bg-transparent px-3 py-3 outline-none focus:border-[#2E7CF6] dark:border-white/10" />
            </label>
          )}
        </section>
        <aside className="surface-card h-fit rounded-3xl p-5 sm:p-6">
          <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#2E7CF6]">Question preview</p>
          <h2 className="mt-3 font-display text-xl font-black leading-snug">{preview}</h2>
          <div className="mt-5 rounded-2xl bg-black/[.03] p-4 text-sm dark:bg-white/[.04]">
            <p className="font-bold">Seed liquidity</p>
            <p className="mt-1 text-zinc-500">{ARENA_CREATION_SEED_TICK} TICK is added at creation. Winners share the eligible pool after fees.</p>
            <p className="mt-3 text-xs text-zinc-500">Your balance: {balance === null ? "Checking…" : `${(Number(balance) / 1e18).toLocaleString()} TICK`}</p>
            <p className="mt-3 text-xs text-zinc-500">A raw move of 30 percent or more on either side voids the clash and refunds stakes.</p>
          </div>
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{error}</p>
          )}
          <button type="button" onClick={() => (authenticated ? void create() : login())} disabled={authenticated && (!ready || pending)} className="mt-5 w-full rounded-xl bg-[#2E7CF6] px-5 py-3 font-extrabold text-white disabled:opacity-50">
            {!authenticated ? "Connect wallet" : pending ? "Creating clash…" : `Create and seed · ${ARENA_CREATION_SEED_TICK} TICK`}
          </button>
        </aside>
      </div>
    </main>
  );
}
