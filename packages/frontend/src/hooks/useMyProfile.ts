/**
 * useMyProfile — the logged-in user's Supabase-backed profile.
 *
 * Source of truth is the backend (GET /api/social/profiles/me). null = no
 * profile claimed yet (the OnboardingModal handles claiming). Module-level
 * cache keeps the header / create page / profile page from refetching.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useTickr } from "./useTickr";
import { social, type MyProfile } from "../lib/social";

let cache: MyProfile | null | undefined; // undefined = not loaded yet

export function useMyProfile() {
  const { authenticated, playerAddress } = useTickr();
  const { getAccessToken } = usePrivy();
  const [profile, setProfile] = useState<MyProfile | null>(cache ?? null);
  const [loading, setLoading] = useState(cache === undefined);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!authenticated || !playerAddress) {
      cache = undefined;
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await social.me(playerAddress, getAccessToken);
      cache = p;
      setProfile(p);
    } catch (e) {
      setProfile(null);
      setError(e instanceof Error ? e.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [authenticated, playerAddress, getAccessToken]);

  useEffect(() => {
    if (!authenticated || !playerAddress) {
      cache = undefined;
      setProfile(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (cache !== undefined) {
      setProfile(cache);
      setLoading(false);
      return;
    }
    refetch();
  }, [authenticated, playerAddress, refetch]);

  return {
    profile,
    loading,
    error,
    refetch,
    hasProfile: profile !== null,
  };
}
