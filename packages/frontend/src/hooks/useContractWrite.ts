/**
 * Sponsored write primitive — every user transaction goes through
 * useSponsoredTransaction (gas-sponsored smart wallet), this adds
 * ABI encoding + receipt waiting + pending/error state.
 */

"use client";

import { useCallback, useState } from "react";
import { encodeFunctionData, type Abi, type Address, type Hex } from "viem";
import { useSponsoredTransaction } from "./useSponsoredTransaction";
import { getPublicClient } from "./usePublicClient";
import { toast } from "../components/Toast";

/** Clear message shown when a write is attempted before the wallet is ready. */
const WALLET_NOT_READY = "Your wallet is still connecting — try again in a moment.";

export function useContractWrite() {
  const { sendSponsoredTx, sendBatchedTx, ready } = useSponsoredTransaction();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = useCallback(
    async (params: {
      to?: Address;
      address?: Address;
      abi: Abi;
      functionName: string;
      args?: unknown[];
      label?: string;
      /**
       * Called the moment the tx is broadcast (hash known), BEFORE the
       * receipt is awaited. Use this for one-tap/optimistic UX: toast
       * immediately, reconcile later from invalidated queries.
       */
      onHashed?: (hash: Hex) => void;
    }): Promise<Hex> => {
      if (!ready) {
        // A disabled-but-clickable CTA would otherwise surface a vague
        // contract/rpc error — fail fast with something a human can act on.
        setError(WALLET_NOT_READY);
        toast.error("Wallet not ready", WALLET_NOT_READY);
        throw new Error(WALLET_NOT_READY);
      }
      setPending(true);
      setError(null);
      try {
        const data = encodeFunctionData({
          abi: params.abi,
          functionName: params.functionName,
          args: params.args as never[],
        });
        const hash = await sendSponsoredTx({ to: params.to ?? params.address!, data });
        // Optimistic callbacks fire at broadcast — the receipt can take
        // seconds; the UI should never block on it.
        params.onHashed?.(hash);
        const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(
            `${params.label ?? "Transaction"} reverted on-chain (tx ${hash}).`
          );
        }
        return hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setPending(false);
      }
    },
    // `ready` is intentionally not a dependency: it only guards the entry
    // point, and including it would recreate the callback every time the
    // wallet readiness flag flips.
    [sendSponsoredTx]
  );

  /**
   * Batched write (improvement B) — multiple calls in one userOp on the
   * smart-wallet path; sequential sponsored txs on the embedded path.
   * Same receipt-waiting + onHashed semantics as write(), but onHashed
   * fires when the LAST call is broadcast.
   */
  const writeBatch = useCallback(
    async (
      calls: Array<{
        to?: Address;
        address?: Address;
        abi: Abi;
        functionName: string;
        args?: unknown[];
        label?: string;
      }>,
      opts?: { label?: string; onHashed?: (hash: Hex) => void }
    ): Promise<Hex> => {
      if (!ready) {
        setError(WALLET_NOT_READY);
        toast.error("Wallet not ready", WALLET_NOT_READY);
        throw new Error(WALLET_NOT_READY);
      }
      setPending(true);
      setError(null);
      try {
        const encoded = calls.map((c) => ({
          to: c.to ?? c.address!,
          data: encodeFunctionData({
            abi: c.abi,
            functionName: c.functionName,
            args: c.args as never[],
          }),
        }));
        const hash = await sendBatchedTx(encoded);
        opts?.onHashed?.(hash);
        const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error(
            `${opts?.label ?? "Transaction"} reverted on-chain (tx ${hash}).`
          );
        }
        return hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err instanceof Error ? err : new Error(msg);
      } finally {
        setPending(false);
      }
    },
    [sendBatchedTx]
  );

  return { write, writeBatch, pending, status: pending ? "pending" : error ? "error" : "idle", error, clearError: () => setError(null), ready };
}
