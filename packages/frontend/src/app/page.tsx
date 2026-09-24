"use client";

import { usePrivy } from "@privy-io/react-auth";

export default function HomePage() {
  const { ready, authenticated, login, logout, user } = usePrivy();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-4">
      <h1 className="text-3xl font-semibold">TICKR v0.1</h1>
      <p className="text-neutral-400 text-sm max-w-md text-center">
        Phase 0 scaffold — Base Sepolia · TICK token · Privy smart wallets with
        gas sponsorship. Home, Fixtures &amp; Results, Leaderboard, and Profile
        pages land in Phase 3.
      </p>

      {!ready ? (
        <p className="text-neutral-500 text-sm">Loading...</p>
      ) : authenticated ? (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-neutral-300">
            Signed in as {user?.email?.address ?? user?.wallet?.address}
          </p>
          <button
            onClick={logout}
            className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm"
          >
            Log out
          </button>
        </div>
      ) : (
        <button
          onClick={login}
          className="px-5 py-2.5 rounded-lg bg-[var(--tickr-purple)] hover:opacity-90 text-sm font-medium"
        >
          Sign in to TICKR
        </button>
      )}
    </main>
  );
}
