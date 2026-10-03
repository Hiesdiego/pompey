/**
 * Core TICKR auth/wallet hook (spec P3.1).
 *
 * - Privy login/logout state
 * - Smart-wallet (player) address — this is the address that stakes/claims
 * - Embedded-wallet fallback address
 * - Auto-switch connected wallet to the active TICKR chain (Base Sepolia on
 *   testnet); surfaces status so the header can offer a manual switch when
 *   the wallet resists the automatic one.
 */

"use client";

import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { ACTIVE_CHAIN_ID } from "../lib/contracts";
import { useLoginModal } from "../components/LoginModal";

export type ChainStatus = "unknown" | "correct" | "switching" | "failed";

// Module-level: one automatic chain-switch attempt per session, no matter
// how many components consume this hook.
let autoSwitchAttempted = false;
// useTickr is consumed in several parts of the app. Share the in-flight
// creation attempt so simultaneous hook instances cannot create duplicates.
let walletCreationInProgress = false;

export function useTickr() {
  const { ready, authenticated, logout, user } = usePrivy();
  // Login goes through TICKR's own headless modal (components/LoginModal),
  // never Privy's prebuilt modal — one swap here reaches every call site.
  const { open: login } = useLoginModal();
  const { wallets, ready: walletsReady } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const { createWallet } = useCreateWallet();
  const [chainStatus, setChainStatus] = useState<ChainStatus>("unknown");

  const privyUserId: string | null = user?.id ?? null;

  // The smart wallet is the player account for staking/claiming.
  const smartWalletAddress: Address | null =
    (smartWalletClient?.account?.address as Address | undefined) ?? null;

  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const anyWallet = embeddedWallet ?? wallets[0] ?? null;
  const embeddedAddress: Address | null =
    (anyWallet?.address as Address | undefined) ?? null;

  // The sponsored write path uses the embedded wallet when available, so use
  // the same address for balances and claims. Smart Wallet is the fallback.
  const playerAddress: Address | null = embeddedAddress ?? smartWalletAddress;
  const walletLoading =
    ready &&
    authenticated &&
    (!walletsReady || !playerAddress);

  // TICKR uses a headless login modal, so create the embedded wallet after
  // authentication when Privy has not supplied one automatically.
  useEffect(() => {
    if (!ready || !authenticated || !walletsReady) return;
    if (wallets.some((wallet) => wallet.walletClientType === "privy")) return;
    if (walletCreationInProgress) return;

    walletCreationInProgress = true;
    createWallet()
      .catch(() => undefined)
      .finally(() => {
        walletCreationInProgress = false;
      });
  }, [ready, authenticated, walletsReady, wallets, createWallet]);

  const ensureChain = useCallback(async (): Promise<boolean> => {
    if (!walletsReady || wallets.length === 0) return false;
    const wallet = embeddedWallet ?? wallets[0];
    if (!wallet) return false;
    setChainStatus("switching");
    try {
      await wallet.switchChain(ACTIVE_CHAIN_ID);
      setChainStatus("correct");
      return true;
    } catch {
      setChainStatus("failed");
      return false;
    }
  }, [walletsReady, wallets, embeddedWallet]);

  // One automatic attempt per session after login (spec P3.1).
  useEffect(() => {
    if (!authenticated) {
      autoSwitchAttempted = false;
      setChainStatus("unknown");
      return;
    }
    if (!authenticated || !walletsReady || autoSwitchAttempted) return;
    autoSwitchAttempted = true;
    ensureChain().catch(() => undefined);
  }, [authenticated, walletsReady, ensureChain]);

  return {
    ready,
    authenticated,
    login,
    logout,
    user,
    privyUserId,
    walletsReady,
    walletLoading,
    smartWalletAddress,
    smartWalletReady: !!smartWalletClient,
    playerAddress,
    embeddedAddress,
    chainStatus,
    ensureChain,
  };
}
