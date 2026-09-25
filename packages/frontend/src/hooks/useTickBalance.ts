/**
 * TICK balance + testnet faucet (spec P3.3).
 * Balance polls every 15s; the faucet calls TickToken.claimFaucet()
 * through the sponsored smart-wallet transaction path.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { CONTRACTS, TICK_TOKEN_ABI } from "../lib/contracts";
import { getPublicClient } from "./usePublicClient";
import { useContractWrite } from "./useContractWrite";

export function useTickBalance(playerAddress: Address | null) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetError, setFaucetError] = useState<string | null>(null);
  const [faucetTx, setFaucetTx] = useState<string | null>(null);
  const { write } = useContractWrite();

  const refresh = useCallback(async () => {
    if (!playerAddress || !CONTRACTS.tickToken) {
      setBalance(null);
      return;
    }
    try {
      const v = (await getPublicClient().readContract({
        address: CONTRACTS.tickToken,
        abi: TICK_TOKEN_ABI,
        functionName: "balanceOf",
        args: [playerAddress],
      })) as bigint;
      setBalance(v);
    } catch {
      setBalance(null);
    }
  }, [playerAddress]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const claimFaucet = useCallback(async () => {
    if (!CONTRACTS.tickToken) {
      setFaucetError("TICK token address not configured.");
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
  }, [write, refresh]);

  return { balance, refresh, claimFaucet, faucetBusy, faucetError, faucetTx };
}
