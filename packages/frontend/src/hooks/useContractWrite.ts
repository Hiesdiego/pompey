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

export function useContractWrite() {
  const { sendSponsoredTx, ready } = useSponsoredTransaction();
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
    }): Promise<Hex> => {
      setPending(true);
      setError(null);
      try {
        const data = encodeFunctionData({
          abi: params.abi,
          functionName: params.functionName,
          args: params.args as never[],
        });
        const hash = await sendSponsoredTx({ to: params.to ?? params.address!, data });
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
    [sendSponsoredTx, ready]
  );

  return { write, pending, status: pending ? "pending" : error ? "error" : "idle", error, clearError: () => setError(null), ready };
}
