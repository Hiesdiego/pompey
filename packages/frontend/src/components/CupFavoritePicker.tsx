"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { X } from "lucide-react";
import { StakeDialog } from "./StakeDialog";
import { CupTeamBadge } from "./CupTeamBadge";
import { CupFavoriteBadge } from "./CupFavoriteBadge";
import { useMyProfile } from "../hooks/useMyProfile";
import { social } from "../lib/social";
import { CUP_TEAMS, CUP_FAVORITE_START, CUP_FAVORITE_END, cupTeamName } from "../lib/cup";

export function CupFavoritePicker({ address, authenticated, login }: { address: Address | null; authenticated: boolean; login: () => void }) {
  const { profile, loading, error, refetch } = useMyProfile();
  const { getAccessToken } = usePrivy();
  const currentProfile = profile?.walletAddress.toLowerCase() === address?.toLowerCase() ? profile : null;
  const favorite = currentProfile?.cupFavouriteTeamId ?? null;
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const canPick = now >= CUP_FAVORITE_START && now < CUP_FAVORITE_END;
  const key = `tickr-cup-favorite-prompt:${address?.toLowerCase() ?? "guest"}`;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (loading || !canPick || favorite !== null || (authenticated && !currentProfile)) { setOpen(false); return; }
    if (!localStorage.getItem(key)) setOpen(true);
  }, [loading, canPick, favorite, key, authenticated, currentProfile]);

  const close = () => { localStorage.setItem(key, "1"); setOpen(false); };
  const save = async () => {
    if (selected === null || pending) return;
    setSaveError(null);
    if (!address) return;
    setPending(true);
    try { await social.pickCupFavorite(address, selected, getAccessToken); await refetch(); close(); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Could not save your pick."); }
    finally { setPending(false); }
  };

  return <>
    <div className="mt-5 flex flex-wrap items-center gap-3">
      {favorite !== null ? <CupFavoriteBadge teamId={favorite} /> : canPick && <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-2 text-sm font-extrabold text-black">Pick your World Cup Fav</button>}
      {error && <span className="text-xs text-red-500">Favorite unavailable. Please refresh.</span>}
    </div>
    {open && canPick && favorite === null && <StakeDialog title="Pick your World Cup favorite" size="lg" onClose={close}>
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-amber-600">World Cup Fav</p><h2 className="mt-1 font-display text-2xl font-black">Choose your team</h2></div><button type="button" onClick={close} aria-label="Close" className="rounded-full p-2 hover:bg-black/5 dark:hover:bg-white/10"><X className="h-5 w-5" /></button></div>
      <p className="mt-2 text-sm text-zinc-500">Pick one of the 64 coins, just like choosing your favourite team when signing up. Your choice appears on your profile.</p>
      {authenticated ? <>
        <div className="mt-5 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-5" role="group" aria-label="World Cup teams">
          {CUP_TEAMS.map((team) => <button key={team.teamId} type="button" aria-pressed={selected === team.teamId} title={cupTeamName(team.teamId)} onClick={() => setSelected(team.teamId)} className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border p-2 text-center text-[11px] font-bold transition ${selected === team.teamId ? "border-amber-500 bg-amber-500/15 ring-2 ring-amber-400/30" : "border-black/10 hover:border-amber-400/60 dark:border-white/10"}`}><CupTeamBadge teamId={team.teamId} size={28} showName={false} /><span className="truncate">{team.symbol}</span></button>)}
        </div>
        {saveError && <p role="alert" className="mt-3 text-sm text-red-500">{saveError}</p>}
        <button type="button" onClick={() => void save()} disabled={selected === null || pending || !address} className="mt-5 w-full rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-3 font-extrabold text-black disabled:opacity-50">{pending ? "Saving…" : selected === null ? "Select a team" : `Confirm ${cupTeamName(selected)}`}</button>
      </> : <button type="button" onClick={() => { close(); login(); }} className="mt-5 w-full rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-3 font-extrabold text-black">Sign in to choose</button>}
    </StakeDialog>}
  </>;
}
