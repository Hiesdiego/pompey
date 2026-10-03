/**
 * TICKR v0.3 — backfill price checkpoints from the v0.2 oracle to the v0.3 oracle.
 *
 * The outright (top-of-table) markets settle from the last checkpoint before a
 * reference timestamp, so the new oracle needs the trailing 72h of hourly
 * checkpoints to price those markets correctly from day one.
 *
 * Usage:
 *   NEW_ORACLE_ADDRESS=0x... pnpm backfill:v03:testnet
 *
 * Env:
 *   NEW_ORACLE_ADDRESS       — required: the v0.3 PriceOracle just deployed
 *   OLD_PRICE_ORACLE_ADDRESS — default: 0x8915F4919F6a2031A6aba16D9AAe639BE209b23b
 *   BACKFILL_HOURS           — default: 72
 */
import { network } from "hardhat";
import { isAddress, parseAbi } from "viem";

const OLD_ORACLE_DEFAULT = "0x8915F4919F6a2031A6aba16D9AAe639BE209b23b";
const BACKFILL_HOURS = Number(process.env.BACKFILL_HOURS ?? "72");
const CHUNK = 40; // checkpoint entries per importCheckpoints call

function address(name: string, value: string | undefined): `0x${string}` {
  if (!value || !isAddress(value, { strict: false })) {
    throw new Error(`Missing or invalid ${name} (got "${value}")`);
  }
  return value as `0x${string}`;
}

async function main(): Promise<void> {
  const newOracleAddr = address("NEW_ORACLE_ADDRESS", process.env.NEW_ORACLE_ADDRESS);
  const oldOracleAddr = address("OLD_PRICE_ORACLE_ADDRESS", process.env.OLD_PRICE_ORACLE_ADDRESS ?? OLD_ORACLE_DEFAULT);

  const { viem } = await network.create("baseSepolia");
  const [deployer] = await viem.getWalletClients();
  if (!deployer?.account) throw new Error("No deployer account configured");
  const publicClient = await viem.getPublicClient();

  const oracleAbi = parseAbi([
    "function getPrice(string symbol, uint64 timestamp) external view returns (uint256)",
  ]);
  const oldOracle = {
    read: {
      getPrice: (symbol: string, ts: bigint) =>
        publicClient.readContract({
          address: oldOracleAddr,
          abi: oracleAbi,
          functionName: "getPrice",
          args: [symbol, ts],
        }) as Promise<bigint>,
    },
  };
  const newOracle = await viem.getContractAt("PriceOracle", newOracleAddr);

  // Team list comes from the freshly deployed season's TeamRegistry (same
  // 20-coin roster), resolved via the new oracle's resultEngine -> seasonRegistry.
  const engineAddr = (await newOracle.read.resultEngine()) as `0x${string}`;
  const engine = await viem.getContractAt("ResultEngine", engineAddr);
  const seasonRegistryAddr = (await engine.read.seasonRegistry()) as `0x${string}`;
  const seasonRegistry = await viem.getContractAt("SeasonRegistry", seasonRegistryAddr);
  const teamRegistryAddr = (await seasonRegistry.read.getTeamRegistry([1n])) as `0x${string}`;
  const teamRegistry = await viem.getContractAt("TeamRegistry", teamRegistryAddr);
  const teamCount = Number(await teamRegistry.read.teamCount());
  const symbols: string[] = [];
  for (let i = 0; i < teamCount; i++) {
    const team = (await teamRegistry.read.getTeam([i])) as { symbol: string };
    symbols.push(team.symbol);
  }
  console.log(`Backfilling ${BACKFILL_HOURS}h of checkpoints for ${symbols.length} teams...`);

  const nowHour = Math.floor(Date.now() / 1000 / 3600) * 3600;
  const entries: { symbol: string; timestamp: bigint; price: bigint }[] = [];
  for (const symbol of symbols) {
    for (let h = BACKFILL_HOURS; h >= 1; h--) {
      const ts = BigInt(nowHour - h * 3600);
      try {
        const price = await oldOracle.read.getPrice(symbol, ts);
        if (price > 0n) entries.push({ symbol, timestamp: ts, price });
      } catch {
        // No checkpoint for that hour on the old oracle — skip it.
      }
    }
  }
  console.log(`Collected ${entries.length} checkpoint entries.`);

  for (let i = 0; i < entries.length; i += CHUNK) {
    const batch = entries.slice(i, i + CHUNK);
    const hash = await deployer.writeContract({
      address: newOracleAddr,
      abi: (newOracle as any).abi,
      functionName: "importCheckpoints",
      args: [
        batch.map((e) => e.symbol),
        batch.map((e) => e.timestamp),
        batch.map((e) => e.price),
      ],
      chain: deployer.chain,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  imported ${Math.min(i + CHUNK, entries.length)}/${entries.length} (tx ${hash.slice(0, 12)}…)`);
  }

  console.log("Checkpoint backfill complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
