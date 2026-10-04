/**
 * TICK balance + testnet faucet (spec P3.3), rebuilt on the query layer.
 *
 * The read path is ONE multicall (balanceOf, lastFaucetClaim,
 * faucetCooldown) instead of three sequential readContracts, polled every
 * 15s with stale-while-revalidate semantics. The faucet write path is
 * unchanged from hooks/useTickBalance.ts.
 *
 * Return shape is identical to the old hook: { balance, refresh,
 * claimFaucet, faucetBusy, faucetError, faucetTx, walletReady,
 * nextFaucetClaimAt, faucetReady } — drop-in replacement.
 */

"use client";

import { useCallback, useState } from "react";
import type { Address } from "viem";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CONTRACTS, TICK_TOKEN_ABI } from "../contracts";
import { getPublicClient } from "../../hooks/usePublicClient";
import { useContractWrite } from "../../hooks/useContractWrite";
import { qks } from "./keys";
import { queryClient } from "./queryClient";
import { celebrateClaim } from "../confetti";

interface BalanceData {
  balance: bigint;
  nextFaucetClaimAt: number | null;
}

type MulticallResult =
  | { status: "success"; result: bigint }
  | { status: "failure"; error?: unknown };

export function useTickBalance(playerAddress: Address | null) {
  const addressKey = playerAddress ? playerAddress.toLowerCase() : "none";
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [faucetTx, setFaucetTx] = useState<string | null>(null);
  const { write, ready: walletReady } = useContractWrite();

  const query = useQuery({
    queryKey: qks.balance(addressKey),
    queryFn: async (): Promise<BalanceData> => {
      const token = CONTRACTS.tickToken;
      if (!playerAddress || !token) throw new Error("TICK token not configured");
      // ONE multicall instead of three sequential readContracts.
      const results = (await getPublicClient().multicall({
        contracts: [
          {
            address: token,
            abi: TICK_TOKEN_ABI,
            functionName: "balanceOf",
            args: [playerAddress],
          },
          {
            address: token,
            abi: TICK_TOKEN_ABI,
            functionName: "lastFaucetClaim",
            args: [playerAddress],
          },
          {
            address: token,
            abi: TICK_TOKEN_ABI,
            functionName: "faucetCooldown",
          },
        ],
        allowFailure: true,
      })) as unknown as MulticallResult[];
      if (results[0]?.status !== "success") throw new Error("balanceOf failed");
      const lastClaim =
        results[1]?.status === "success" ? results[1].result : 0n;
      const cooldown =
        results[2]?.status === "success" ? results[2].result : 0n;
      const next = Number(lastClaim + cooldown);
      return {
        balance: (results[0] as { status: "success"; result: bigint }).result,
        nextFaucetClaimAt:
          next > Math.floor(Date.now() / 1000) ? next : null,
      };
    },
    enabled: !!playerAddress && !!CONTRACTS.tickToken,
    staleTime: 10_000,
    refetchInterval: 15_000,
    placeholderData: keepPreviousData,
    // A blip must not blank the balance: keep serving the last value.
    retry: (failureCount) => failureCount < 2,
  });

  const refresh = useCallback(() => {
    return queryClient.invalidateQueries({
      queryKey: qks.balance(addressKey),
    });
  }, [addressKey]);

  const claimFaucet = useCallback(async () => {
    if (!CONTRACTS.tickToken) {
      setFaucetError("TICK token address not configured.");
      return;
    }
    if (!walletReady) {
      setFaucetError("Your wallet is still initializing. Please wait a moment and try again.");
      return;
    }
    setFaucetBusy(true);
    setFaucetError(null);
    setFaucetTx(null);
    try {
      const hash = await write({
        to: CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "claimFaucet",
        label: "Faucet claim",
      });
      setFaucetTx(hash);
      celebrateClaim();
      const cooldown = (await getPublicClient().readContract({
        address: CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "faucetCooldown",
      })) as bigint;
      // Optimistic: the cooldown starts now. The 15s poll confirms on-chain.
      if (playerAddress) {
        queryClient.setQueryData<BalanceData>(
          qks.balance(playerAddress.toLowerCase()),
          (old) => ({
            balance: old?.balance ?? 0n,
            nextFaucetClaimAt: Math.floor(Date.now() / 1000) + Number(cooldown),
          })
        );
      }
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setFaucetError(
        msg.includes("FaucetCooldownActive")
          ? "Faucet on cooldown — you already claimed recently. Try again later."
          : msg.includes("FaucetDisabled")
            ? "The faucet is currently disabled."
            : msg
      );
    } finally {
      setFaucetBusy(false);
    }
  }, [write, refresh, walletReady, playerAddress]);

  const nextFaucetClaimAt = query.data?.nextFaucetClaimAt ?? null;
  const faucetReady =
    nextFaucetClaimAt === null ||
    nextFaucetClaimAt <= Math.floor(Date.now() / 1000);

  return {
    balance: query.data?.balance ?? null,
    refresh,
    claimFaucet,
    faucetBusy,
    faucetError,
    faucetTx,
    walletReady,
    nextFaucetClaimAt,
    faucetReady,
  };
}
