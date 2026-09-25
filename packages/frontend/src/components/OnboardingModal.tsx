/**
 * OnboardingModal (spec P3.2) — first-login only, once ever.
 * Unique username (client-side validation) + favourite team picker.
 * Stored in localStorage keyed by Privy user id.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { useTickr } from "../hooks/useTickr";
import { useTeams, type TeamInfo } from "../hooks/useTeams";
import { getProfile, saveProfile, validateUsername } from "../lib/profile";
import { cn } from "../lib/cn";

function TeamOption({
  team,
  selected,
  onSelect,
}: {
  team: TeamInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-all active:scale-95",
        selected
          ? "border-[#2E7CF6] bg-[#2E7CF6]/12 shadow-[0_0_16px_rgba(46,124,246,.25)] dark:bg-[#2E7CF6]/15"
          : "border-black/8 bg-black/[.02] hover:border-[#2E7CF6]/40 dark:border-white/8 dark:bg-white/[.02] dark:hover:border-[#2E7CF6]/40"
      )}
    >
      {team.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.imageUrl} alt={team.symbol} width={28} height={28} className="rounded-full" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] text-xs font-bold text-white">
          {team.symbol.slice(0, 1)}
        </span>
      )}
      <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">{team.symbol}</span>
      {selected && <Check className="h-3 w-3 text-[#2E7CF6]" />}
    </button>
  );
}

export function OnboardingModal({ onDone }: { onDone?: () => void }) {
  const { authenticated, privyUserId, playerAddress } = useTickr();
  const { teams, loading } = useTeams();
  const [visible, setVisible] = useState(false);
  const [username, setUsername] = useState("");
  const [teamId, setTeamId] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fire once ever: only when authenticated, wallet known, and no stored profile.
  useEffect(() => {
    if (!authenticated || !privyUserId || !playerAddress) return;
    if (getProfile(privyUserId)) return;
    setVisible(true);
  }, [authenticated, privyUserId, playerAddress]);

  const usernameError = useMemo(
    () => (username === "" && !touched ? null : validateUsername(username, playerAddress)),
    [username, touched, playerAddress]
  );

  const canSave = usernameError === null && username.trim() !== "" && teamId !== null && !saving;

  const handleSave = () => {
    if (!canSave || !privyUserId || !playerAddress || teamId === null) return;
    setSaving(true);
    saveProfile({
      username: username.trim(),
      favouriteTeamId: teamId,
      address: playerAddress.toLowerCase(),
      privyUserId,
      createdAt: Date.now(),
    });
    setVisible(false);
    setSaving(false);
    onDone?.();
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <div className="glass-strong max-h-[90vh] w-full max-w-lg animate-page-in overflow-y-auto rounded-3xl p-6 md:p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_20px_rgba(46,124,246,.45)]">
            <Sparkles className="h-4 w-4 text-white" />
          </span>
          <h2 className="font-display text-xl font-bold text-zinc-900 dark:text-white">
            Welcome to TICKR
          </h2>
        </div>
        <p className="mb-5 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick a username and your favourite team to get started. This only happens once.
        </p>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Username
        </label>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setTouched(true);
          }}
          maxLength={20}
          placeholder="e.g. satoshi_bets"
          className={cn(
            "w-full rounded-xl border bg-black/[.03] px-3 py-2.5 text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:ring-2 focus:ring-[#2E7CF6]/40 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600",
            touched && usernameError
              ? "border-red-500"
              : "border-black/10 focus:border-[#2E7CF6] dark:border-white/10"
          )}
        />
        {touched && usernameError ? (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">{usernameError}</p>
        ) : (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
            3–20 characters: letters, numbers, underscores.
          </p>
        )}

        <label className="mb-2 mt-5 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Favourite team
        </label>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin text-[#2E7CF6]" /> Loading teams…
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {teams.map((t) => (
              <TeamOption
                key={t.teamId}
                team={t}
                selected={teamId === t.teamId}
                onSelect={() => setTeamId(t.teamId)}
              />
            ))}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!canSave}
          className={cn(
            "mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
            canSave
              ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_34px_rgba(46,124,246,.6)]"
              : "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
          )}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Start playing
        </button>
        <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
          Your profile is stored on this device for now.
        </p>
      </div>
    </div>
  );
}
