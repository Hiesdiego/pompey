import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * TICKR v0.2 — full contract graph deployment (Season 1).
 *
 * Split into PERSISTENT contracts (deployed once, survive every future
 * season) and PER-SEASON contracts (redeployed fresh each time a new
 * season starts, since the roster/fixture list can change):
 *
 *   PERSISTENT: TickToken, PlayerStats, SeasonRegistry, PredictionPool,
 *               PriceOracle, ResultEngine, MarketFactory
 *   PER-SEASON: TeamRegistry, MatchRegistry
 *
 * Deploy order:
 *   1. TickToken, PlayerStats, SeasonRegistry (no dependencies)
 *   2. TeamRegistry (season 1 roster)
 *   3. MatchRegistry (needs TeamRegistry) — v0.2 adds matchDurationSeconds
 *   4. PredictionPool, PriceOracle, ResultEngine, MarketFactory (need
 *      SeasonRegistry and/or each other)
 *   5. Wiring calls (one-time setters — see each contract's setX function)
 *   6. SeasonRegistry.startNewSeason(TeamRegistry, MatchRegistry) — this is
 *      what makes season 1 "live" and resolvable by seasonId=1 everywhere.
 *
 * v0.2 changes:
 *   - MatchRegistry: matchDurationSeconds (default 3600 = 1 hour). Owner may
 *     tune it later for season 2+ via setMatchDuration; the fixture's
 *     betting window is derived from it at kickoff reveal.
 *   - MarketFactory: the permissionless outright-markets engine. Anyone can
 *     create a market from the 5 templates (TOP_GAINER, CHAMPION, H2H,
 *     TARGET, SPREAD) for a 250-TICK creation fee that becomes unallocated
 *     seed liquidity; resolution is permissionless (anyone may call
 *     resolve()) and fully on-chain-data-driven.
 *
 * IMPORTANT — kickoff reveal is backend-signed, NOT VRF-based (see the
 * design note at the top of MatchRegistry.sol for why). This means there
 * is no Chainlink subscription to set up; `backendSigner` just needs to be
 * a wallet address your Phase 2 backend controls.
 *
 * For a FUTURE season (season 2+), do NOT re-run this whole module — just
 * deploy a fresh TeamRegistry + MatchRegistry pair and call
 * SeasonRegistry.startNewSeason() with their addresses. Everything else
 * (TICK, PlayerStats, PredictionPool, PriceOracle, ResultEngine,
 * MarketFactory) stays the same contract instance across every season.
 */
export default buildModule("TickrV02Module", (m) => {
  const owner = m.getAccount(0);

  // The wallet your Phase 2 backend will use to sign price submissions AND
  // kickoff reveals. Defaults to the deployer for a quick testnet setup —
  // override via parameters for anything beyond local experimentation.
  const backendSigner = m.getParameter("backendSigner", owner);

  // Tickr treasury — receives the entire pool when a fixture settles with no
  // stakers in the winning outcome, and unclaimed market seeds. Defaults to
  // the deployer on testnet; point it at a multisig for mainnet via
  // parameters.
  const treasury = m.getParameter("treasury", owner);

  // v0.2: match duration in seconds (default 1 hour). Locked per fixture at
  // kickoff reveal; only future reveals are affected by changes.
  const matchDurationSeconds = m.getParameter("matchDurationSeconds", 3600n);

  // --- Persistent contracts ---
  const initialTickSupply = 10_000_000n * 10n ** 18n;
  const tickToken = m.contract("TickToken", [owner, initialTickSupply]);
  const playerStats = m.contract("PlayerStats", [owner]);
  const seasonRegistry = m.contract("SeasonRegistry", [owner]);

  const predictionPool = m.contract("PredictionPool", [
    owner,
    tickToken,
    seasonRegistry,
    playerStats,
    treasury,
  ]);

  const priceOracle = m.contract("PriceOracle", [owner, backendSigner]);
  const resultEngine = m.contract("ResultEngine", [owner, seasonRegistry]);

  // --- Season 1: per-season contracts ---
  const teamNames = [
    "Bitcoin", "Ethereum", "Somnia", "Binance Coin", "Solana",
    "Cardano", "Ripple", "Polygon", "Dogecoin", "Avalanche",
    "Litecoin", "Sui", "Tron", "Chainlink", "Polkadot",
    "Near", "Ton", "Filecoin", "Cosmos", "Shiba Inu",
  ];
  const teamSymbols = [
    "BTC", "ETH", "SOMI", "BNB", "SOL",
    "ADA", "XRP", "POL", "DOGE", "AVAX",
    "LTC", "SUI", "TRX", "LINK", "DOT",
    "NEAR", "TON", "FIL", "ATOM", "SHIB",
  ];
  const teamRegistrySeason1 = m.contract("TeamRegistry", [owner, teamNames, teamSymbols], {
    id: "TeamRegistrySeason1",
  });

  const matchRegistrySeason1 = m.contract(
    "MatchRegistry",
    [owner, teamRegistrySeason1, backendSigner, matchDurationSeconds],
    { id: "MatchRegistrySeason1" }
  );

  // --- v0.2: MarketFactory (persistent — all seasons) ---
  const marketFactory = m.contract("MarketFactory", [
    owner,
    tickToken,
    seasonRegistry,
    priceOracle,
    resultEngine,
    treasury,
  ]);

  // --- Persistent contract wiring (one-time setters) ---
  m.call(playerStats, "setPredictionPool", [predictionPool]);
  m.call(predictionPool, "setResultEngine", [resultEngine]);
  m.call(priceOracle, "setResultEngine", [resultEngine]);
  m.call(resultEngine, "setPredictionPool", [predictionPool]);
  m.call(resultEngine, "setPriceOracle", [priceOracle]);
  m.call(matchRegistrySeason1, "setResultEngine", [resultEngine]);

  // Register season 1 as "live" — after this, seasonId=1 resolves to this
  // exact TeamRegistry/MatchRegistry pair everywhere in the persistent
  // contracts.
  m.call(seasonRegistry, "startNewSeason", [teamRegistrySeason1, matchRegistrySeason1], {
    id: "StartSeason1",
  });

  return {
    tickToken,
    playerStats,
    seasonRegistry,
    predictionPool,
    priceOracle,
    resultEngine,
    marketFactory,
    teamRegistrySeason1,
    matchRegistrySeason1,
  };
});
