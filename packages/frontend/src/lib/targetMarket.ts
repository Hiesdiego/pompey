import { decodeAbiParameters, parseAbiParameters } from "viem";

export interface TargetTerms {
  teamId: number;
  target: number;
  atTime: number;
  above: boolean;
}

export function decodeTargetTerms(params: `0x${string}`): TargetTerms | null {
  try {
    const [teamId, price, atTime, above] = decodeAbiParameters(
      parseAbiParameters("uint16, uint256, uint64, bool"), params
    );
    const target = Number(price) / 1e8;
    if (!Number.isFinite(target) || target <= 0) return null;
    return { teamId: Number(teamId), target, atTime: Number(atTime), above };
  } catch {
    return null;
  }
}

export function formatUsd(price: number): string {
  return `$${price.toLocaleString("en-US", {
    minimumFractionDigits: price < 1 ? 4 : 2,
    maximumFractionDigits: price < 1 ? 8 : 2,
  })}`;
}
