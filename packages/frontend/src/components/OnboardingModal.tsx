/**
 * OnboardingModal (spec P3.2) — first-login only, once ever.
 * Unique username (client-side validation) + favourite team picker.
 * Stored in localStorage keyed by Privy user id.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
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
        "flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition-all",
        selected
          ? "border-[#7F77DD] bg-[#7F77DD]/15"
          : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-600"
      )}
    >
      {team.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={team.imageUrl} alt={team.symbol} width={28} height={28} className="rounded-full" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#7F77DD] to-[#1D9E75] text-xs font-bold text-white">
          {team.symbol.slice(0, 1)}
        </span>
      )}
      <span className="text-[10px] font-semibold text-zinc-300">{team.symbol}</span>
      {selected && <Check className="h-3 w-3 text-[#7F77DD]" />}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-700 bg-[#141416] p-6">
        <h2 className="text-xl font-black text-white">Welcome to TICKR</h2>
        <p className="mb-5 mt-1 text-sm text-zinc-400">
          Pick a username and your favourite team to get started. This only happens once.
        </p>

        <label className="mb-1 block text-xs font-medium text-zinc-400">Username</label>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setTouched(true);
          }}
          maxLength={20}
          placeholder="e.g. satoshi_bets"
          className={cn(
            "w-full rounded-xl border bg-zinc-900 px-3 py-2.5 text-white outline-none",
            touched && usernameError ? "border-red-500" : "border-zinc-700 focus:border-[#7F77DD]"
          )}
        />
        {touched && usernameError ? (
          <p className="mt-1 text-xs text-red-400">{usernameError}</p>
        ) : (
          <p className="mt-1 text-xs text-zinc-600">3–20 characters: letters, numbers, underscores.</p>
        )}

        <label className="mb-2 mt-5 block text-xs font-medium text-zinc-400">
          Favourite team
        </label>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading teams…
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
            "mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white",
            canSave ? "bg-[#7F77DD] hover:bg-[#6f68d6]" : "cursor-not-allowed bg-zinc-700"
          )}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Start playing
        </button>
        <p className="mt-2 text-center text-[11px] text-zinc-600">
          Your profile is stored on this device for now.
        </p>
      </div>
    </div>
  );
}
