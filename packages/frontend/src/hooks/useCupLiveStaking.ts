"use client";

import { useEffect, useState } from "react";
import { CUP_CONTRACTS, CUP_POOL_ABI } from "../lib/cup";
import { getPublicClient } from "./usePublicClient";

export function useCupLiveStaking(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!CUP_CONTRACTS.matchPool) return;
    let active = true;
    getPublicClient().readContract({ address: CUP_CONTRACTS.matchPool, abi: CUP_POOL_ABI, functionName: "liveMatchStakingEnabled" })
      .then((value) => { if (active) setEnabled(value === true); })
      .catch(() => { if (active) setEnabled(false); });
    return () => { active = false; };
  }, []);
  return enabled;
}
