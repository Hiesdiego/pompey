"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback } from "react";
import type { Address, Hex } from "viem";

/**
 * Wraps Privy's smart wallet client so the rest of the app never has to
 * think about account abstraction directly. Every call here is eligible
 * for gas sponsorship once the Base Sepolia sponsorship policy is enabled
 * in the Privy Dashboard — no changes needed on this side when that's
 * toggled on.
 */
export function useSponsoredTransaction() {
  const { client } = useSmartWallets();

  const sendSponsoredTx = useCallback(
    async (params: { to: Address; data: Hex; value?: bigint }) => {
      if (!client) {
        throw new Error("Smart wallet client not ready — user may not be logged in yet.");
      }

      const txHash = await client.sendTransaction({
        calls: [
          {
            to: params.to,
            data: params.data,
            value: params.value ?? 0n,
          },
        ],
      });

      return txHash;
    },
    [client]
  );

  return { sendSponsoredTx, ready: !!client };
}
