import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters } from "viem";
import { getPublicClient } from "../hooks/usePublicClient";
import { MARKET_FACTORY_ABI, MARKET_FACTORY_ADDRESSES, TEMPLATES } from "./marketFactory";

/** Decode and re-encode so alternate byte encodings cannot bypass term matching. */
export function canonicalMarketTerms(templateId: number, params: `0x${string}`): string {
  const signature = templateId === TEMPLATES.TOP_GAINER ? "uint256, uint8"
    : templateId === TEMPLATES.CHAMPION ? "uint256"
    : templateId === TEMPLATES.H2H ? "uint16, uint16, uint64, uint64"
    : templateId === TEMPLATES.TARGET ? "uint16, uint256, uint64, bool"
    : "uint256, uint256, int16";
  const types = parseAbiParameters(signature);
  return `${templateId}:${encodeAbiParameters(types, decodeAbiParameters(types, params))}`;
}

/** Every configured deployment participates, including settled and voided markets. */
export async function readCreatedMarkets() {
  const client = getPublicClient();
  const groups = await Promise.all(MARKET_FACTORY_ADDRESSES.map(async (factory) => {
    const count = await client.readContract({ address: factory, abi: MARKET_FACTORY_ABI, functionName: "marketCount" });
    const results = await client.multicall({ allowFailure: false, contracts: Array.from({ length: Number(count) }, (_, id) => ({
      address: factory, abi: MARKET_FACTORY_ABI, functionName: "marketInfo" as const, args: [BigInt(id)] as const,
    })) });
    return results.map((info, id) => ({ factory, id: BigInt(id), templateId: Number(info[0]), params: info[7] }));
  }));
  return groups.flat();
}
