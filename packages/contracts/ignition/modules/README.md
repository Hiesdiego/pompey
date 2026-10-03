# Deploying TICKR v0.1 to Base Sepolia

## 1. Prerequisites

- A funded Base Sepolia wallet (get testnet ETH from https://www.coinbase.com/faucets/base-ethereum-sepolia-faucet)
- A Base Sepolia RPC URL (the public one `https://sepolia.base.org` works, or use your own from Alchemy/Infura for reliability)
- A second wallet address to act as your **backend signer** — the address
  your Phase 2 backend will use to sign price submissions (`PriceOracle`)
  and kickoff reveals (`MatchRegistry`). For a quick local/testnet setup you
  can reuse your deployer wallet and change it later via
  `setBackendSigner()` on both contracts.

Note: earlier versions of this deployment used Chainlink VRF for the
kickoff-reveal mystery. That's been replaced with a simpler backend-signed
reveal — see the design note at the top of `MatchRegistry.sol` for why.
There is no Chainlink subscription to set up for v0.1.

## 2. Configure secrets

```bash
cd packages/contracts
pnpm hardhat keystore set BASE_SEPOLIA_RPC_URL
pnpm hardhat keystore set BASE_SEPOLIA_PRIVATE_KEY
pnpm hardhat keystore set BASESCAN_API_KEY   # optional, for verification
```

## 3. (Optional) Set a dedicated backend signer

Create `ignition/parameters.json`:

```json
{
  "TickrV01Module": {
    "backendSigner": "0xYOUR_BACKEND_SIGNER_ADDRESS"
  }
}
```

If you skip this, `backendSigner` defaults to your deployer wallet.

## 4. Build, test, deploy

```bash
pnpm hardhat build
pnpm hardhat test          # runs both Solidity and TypeScript tests
pnpm hardhat ignition deploy ignition/modules/Deploy.ts \
  --network baseSepolia \
  --parameters ignition/parameters.json    # omit if you skipped step 3
```

This deploys the full graph AND registers Season 1 as live in one go — no
separate "start season" step needed for the first season.

## 5. After deployment

1. Call `MatchRegistry.generateSchedule(seasonStartTimestamp, matchdayIntervalSeconds)`
   once, as owner, to generate all 380 fixtures for Season 1.
2. Save all deployed addresses — Phase 2 (backend) needs them.

## 6. Starting Season 2+ (later)

Do NOT re-run the whole module. `TickToken`, `PlayerStats`,
`PredictionPool`, `PriceOracle`, and `ResultEngine` persist across every
season — only `TeamRegistry` and `MatchRegistry` get redeployed:

1. Deploy a fresh `TeamRegistry` with the new season's roster.
2. Deploy a fresh `MatchRegistry` pointed at that new `TeamRegistry`.
3. Call `MatchRegistry.setResultEngine(resultEngine)` on the new instance.
4. Call `SeasonRegistry.startNewSeason(newTeamRegistry, newMatchRegistry)`.
5. Call `generateSchedule(...)` on the new `MatchRegistry`.

Any pending claims from the previous season remain fully claimable —
`SeasonRegistry` never forgets old seasons, it just adds new ones.
