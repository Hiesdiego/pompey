"use client";

import { usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback } from "react";
import type { Address, Hex } from "viem";
import { ACTIVE_CHAIN_ID } from "../lib/contracts";

/**
 * Wraps Privy's smart wallet client so the rest of the app never has to
 * think about account abstraction directly. Every call here is eligible
 * for gas sponsorship once the Base Sepolia sponsorship policy is enabled
 * in the Privy Dashboard — no changes needed on this side when that's
 * toggled on.
 */
export function useSponsoredTransaction() {
  const { client } = useSmartWallets();
  const { ready: privyReady, authenticated } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { sendTransaction: sendEmbeddedTransaction } = useSendTransaction();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");

  const sendSponsoredTx = useCallback(
    async (params: { to: Address; data: Hex; value?: bigint }) => {
      // Use Privy's explicit sponsored transaction flow for the embedded
      // wallet. This sends the request with sponsor:true, which applies the
      // Base Sepolia gas sponsorship policy configured in the dashboard.
      if (!privyReady || !authenticated) {
        throw new Error("Privy wallet session is still initializing. Please wait a moment and try again.");
      }
      if (embeddedWallet) {
        const result = await sendEmbeddedTransaction(
          {
            to: params.to,
            data: params.data,
            value: params.value ?? 0n,
            chainId: ACTIVE_CHAIN_ID,
          },
          {
            sponsor: true,
            address: embeddedWallet.address,
          }
        );
        return result.hash;
      }

      // Smart Wallet remains a fallback for accounts without an embedded
      // wallet. Its Privy paymaster configuration is handled by the client.
      if (client) {
        return client.sendTransaction({
          calls: [
            {
              to: params.to,
              data: params.data,
              value: params.value ?? 0n,
            },
          ],
        });
      }
      throw new Error("No usable transaction wallet is available. Finish signing in, then try again.");
    },
    [
      client,
      privyReady,
      authenticated,
      embeddedWallet,
      sendEmbeddedTransaction,
    ]
  );

  return {
    sendSponsoredTx,
    // Ordinary wallet readiness is sufficient because the embedded-wallet
    // fallback does not require a smart-wallet client.
    ready: !!client || (privyReady && authenticated && walletsReady && !!embeddedWallet),
  };
}
