/**
 * OnboardingModal — first-login username claim, backed by Supabase.
 *
 * When the wallet is authenticated and the backend has no profile for it,
 * shows the claim form: unique username (server-enforced) + favourite team
 * picker + optional bio. Claim writes via PUT /api/social/profiles/me.
 * Also dual-writes the device-local directory so the Main League board keeps
 * its "you" highlight.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { useTickr } from "../hooks/useTickr";
import { useTeams, type TeamInfo } from "../hooks/useTeams";
import { social, ApiError } from "../lib/social";
import { saveProfile as saveLocalProfile } from "../lib/profile";
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

function validateUsernameClient(raw: string): string | null {
  const name = raw.trim();
  if (name.length < 3) return "Username must be at least 3 characters.";
  if (name.length > 20) return "Username must be at most 20 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return "Only letters, numbers and underscores allowed.";
  return null;
}

const SERVER_ERRORS: Record<string, string> = {
  username_taken: "That username is taken — try another.",
  invalid_username: "Usernames are 3–20 chars: letters, numbers, underscores.",
  locked_until_next_season: "Username changes unlock when the next season begins.",
  invalid_team: "Pick a valid team.",
  invalid_bio: "Bio must be 160 characters or fewer.",
};

export function OnboardingModal({ onDone }: { onDone?: () => void }) {
  const { authenticated, privyUserId, playerAddress } = useTickr();
  const { getAccessToken } = usePrivy();
  const { teams, loading } = useTeams();
  const [checking, setChecking] = useState(true);
  const [visible, setVisible] = useState(false);
  const [username, setUsername] = useState("");
  const [teamId, setTeamId] = useState<number | null>(null);
  const [bio, setBio] = useState("");
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Fire when authenticated and the backend has no profile for this wallet.
  // A backend outage never blocks login — the modal just stays hidden.
  useEffect(() => {
    if (!authenticated || !playerAddress) {
      setChecking(false);
      return;
    }
    let alive = true;
    setChecking(true);
    social
      .me(playerAddress, getAccessToken)
      .then((p) => {
        if (alive) setVisible(p === null);
      })
      .catch(() => {
        if (alive) setVisible(false);
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [authenticated, playerAddress, getAccessToken]);

  const usernameError = useMemo(
    () => (username === "" && !touched ? null : validateUsernameClient(username)),
    [username, touched]
  );

  const canSave =
    usernameError === null &&
    username.trim() !== "" &&
    teamId !== null &&
    bio.length <= 160 &&
    !saving;

  const handleSave = async () => {
    if (!canSave || !privyUserId || !playerAddress || teamId === null) return;
    setSaving(true);
    setServerError(null);
    const uname = username.trim().toLowerCase();
    try {
      await social.saveProfile(
        {
          walletAddress: playerAddress,
          username: uname,
          favouriteTeamId: teamId,
          bio: bio.trim(),
        },
        getAccessToken
      );
      // Dual-write the device-local directory (Main League "you" highlight).
      try {
        saveLocalProfile({
          username: uname,
          favouriteTeamId: teamId,
          address: playerAddress.toLowerCase(),
          privyUserId,
          createdAt: Date.now(),
        });
      } catch {
        /* non-fatal */
      }
      setVisible(false);
      onDone?.();
    } catch (e) {
      const code = e instanceof ApiError ? e.message : "";
      setServerError(SERVER_ERRORS[code] ?? (e instanceof Error ? e.message : "Claim failed — try again."));
    } finally {
      setSaving(false);
    }
  };

  if (checking || !visible) return null;

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
          Claim your username and pick your favourite team. Your profile is
          public — everyone can see your predictions.
        </p>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Username
        </label>
        <input
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            setTouched(true);
            setServerError(null);
          }}
          maxLength={20}
          placeholder="e.g. satoshi_bets"
          className={cn(
            "w-full rounded-xl border bg-black/[.03] px-3 py-2.5 text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:ring-2 focus:ring-[#2E7CF6]/40 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600",
            (touched && usernameError) || serverError
              ? "border-red-500"
              : "border-black/10 focus:border-[#2E7CF6] dark:border-white/10"
          )}
        />
        {serverError ? (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">{serverError}</p>
        ) : touched && usernameError ? (
          <p className="mt-1 text-xs text-red-500 dark:text-red-400">{usernameError}</p>
        ) : (
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
            3–20 characters: letters, numbers, underscores. One change per season.
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

        <label className="mb-1 mt-5 block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Bio <span className="font-normal normal-case text-zinc-400">(optional)</span>
        </label>
        <input
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={160}
          placeholder="A line about your betting style…"
          className="w-full rounded-xl border border-black/10 bg-black/[.03] px-3 py-2.5 text-sm text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:border-[#2E7CF6] focus:ring-2 focus:ring-[#2E7CF6]/40 dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-zinc-600"
        />
        <p className="mt-1 text-right text-[11px] tabular-nums text-zinc-400 dark:text-zinc-600">
          {bio.length}/160
        </p>

        <button
          onClick={handleSave}
          disabled={!canSave}
          className={cn(
            "mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white transition-all active:scale-[.98]",
            canSave
              ? "bg-gradient-to-b from-[#2E7CF6] to-[#1D4ED8] shadow-[0_0_24px_rgba(46,124,246,.45)] hover:shadow-[0_0_34px_rgba(46,124,246,.6)]"
              : "cursor-not-allowed bg-zinc-300 dark:bg-zinc-700"
          )}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? "Claiming…" : "Claim username"}
        </button>
        <p className="mt-2 text-center text-[11px] text-zinc-400 dark:text-zinc-600">
          Stored in the TICKR directory — username and team can change once per season.
        </p>
      </div>
    </div>
  );
}
