---
project: TICKR
version: v0.1
type: build-specification
target_chain: Base (Base Sepolia for v0.1, Base mainnet for production)
audience: AI coding agent context (e.g. Claude Code) — also human-readable
status: draft, resolved from build notes — updated 2026-09-24 to match deployed TickrV01Module (Season 1 live)
---

# TICKR — Build Specification (v0.1)

## How to use this document

This is a build-context file for an AI coding agent working through the TICKR repo. Tasks are grouped into six phases, each with an ID, a description, explicit dependencies, and acceptance criteria written as checkboxes. Work phase by phase — a phase's tasks should not start until every task it "Depends on" is checked off. Section 8 lists assumptions this document resolves; re-verify them with the project owner if anything looks inconsistent with newer instructions.

---

## 1. Project Overview

TICKR is a crypto-native competitive league where real cryptocurrencies act as "teams." Match results are determined by each coin's price performance over the match window. The system is fully on-chain and automated, and is designed to feel simultaneously like a football (soccer) league, a prediction market, and a trading game.

- Solo developer build
- Phased rollout: Infrastructure → Smart Contracts → Backend → Frontend → Integration/QA → Launch
- v0.1 scope: 20-team league, no promotion/relegation, on a **season-capable architecture** (superseding the earlier "no seasons" decision — see §8.5). `TickToken`, `PlayerStats`, `PredictionPool`, `PriceOracle`, and `ResultEngine` deploy once and persist across all seasons; `TeamRegistry` and `MatchRegistry` redeploy per season and register with `SeasonRegistry`. Season 1 is live and is, for now, the only season — functionally a permanent league until a Season 2 is explicitly started.

## 2. Tech Stack & Constraints

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces (`contracts`, `backend`, `frontend`, `shared`) |
| Chain | **Base** — Base Sepolia testnet for v0.1, Base mainnet for production |
| Smart contracts | Solidity, Hardhat 3, TypeScript, Hardhat Ignition for deploys |
| Frontend | Next.js 16, App Router, Tailwind CSS, shadcn/ui — use latest package versions, no hardcoded version pins |
| Auth | Privy — wallet connect + embedded wallet |
| Backend | Node.js, REST + WebSocket API |
| Price data | CoinGecko (REST poll) + Binance (WebSocket), median of both sources with outlier rejection |
| Native token | `TICK` — ERC-20, admin/fixed price, testnet faucet function |
| Randomness | None — VRF dropped (see §8.5). Kickoff times are backend-signed via `MatchRegistry.revealKickoff`, on-chain-enforced to 30–120 min out from the reveal call |
| Package manager | pnpm |

> **Note:** an earlier draft of this plan referenced "Somnia Testnet" as the deployment target in Phase 0 and Phase 5. That has been superseded — the confirmed chain is **Base**. See Section 8.

## 3. Core Game Rules

- **League structure:** 20 teams, single league, no promotion/relegation in v0.1.
- **Fixtures:** 38 matches — full home-and-away round robin.
- **Result determination:** result = rounded percentage price change per coin, comparing a start snapshot to an end snapshot. If both teams' rounded % change is equal, the match is a draw.
- **Kickoff timing:** no plaintext kickoff time exists pre-reveal (fixture stores `kickoffTimestamp: 0, kickoffRevealed: false` until then). `MatchRegistry.revealKickoff` (backend-signed, not VRF — see §8.5) sets the real timestamp, on-chain-bounded to 30–120 minutes from the call. Betting is always open pre-reveal and closes the instant the revealed kickoff arrives. Do not expose a fixture's kickoff earlier than its own `revealKickoff` call.
- **Staking:** open parimutuel pools, denominated in `TICK` only. Each match has 3 outcome pools (Win-Team1 / Draw / Win-Team2). Pool sizes are visible immediately as stakes come in — this is **not** a commit-reveal system.
- **Team selection:** on a user's very first login ever, prompt them to pick a favourite team from the current season's 20. This is an off-chain/frontend concern (P3.2) and is unaffected by the season architecture — it fires once per user account, not once per season.

## 4. Final Team Roster (20 teams)

| # | Team | # | Team |
|---|---|---|---|
| 1 | Bitcoin | 11 | Litecoin |
| 2 | Ethereum | 12 | Sui |
| 3 | Somnia | 13 | Tron |
| 4 | Binance | 14 | Chainlink |
| 5 | Solana | 15 | Polkadot |
| 6 | Cardano | 16 | Near |
| 7 | Ripple | 17 | Ton |
| 8 | Polygon | 18 | Filecoin |
| 9 | Dogecoin | 19 | Cosmos |
| 10 | Avalanche | 20 | Shiba Inu |

> **Important disambiguation:** Team #3, "Somnia," is the SOMI token — a coin in the price-battle roster. This is unrelated to the deployment chain, which is Base (Section 2). Do not conflate the two when writing chain config or price-feed code.

> **Risk flag for Phase 2:** before building the price aggregation layer, verify that all 20 assets — particularly lower-liquidity/newer listings like Somnia (SOMI) — have reliable, actively-traded pairs on **both** CoinGecko and Binance. If any asset lacks dual-source coverage, flag it before Phase 2 work begins; the price validator's median/outlier logic depends on having two independent sources per asset.

## 5. Build Phases

### Phase 0 — Foundation & Tooling

*Unblocks: all subsequent phases.*

**P0.1 — Turborepo monorepo scaffold**
Set up a Turborepo + pnpm workspaces monorepo with four packages: `contracts`, `backend`, `frontend`, `shared`.
- [ ] `pnpm-workspace.yaml` defines all four packages
- [ ] `turbo.json` defines build/dev/lint/test pipelines that respect inter-package dependencies
- [ ] `shared` package exports common types (fixture, match, team, user) consumable by contracts (via ABI types), backend, and frontend
- [ ] Root scripts (`pnpm dev`, `pnpm build`, `pnpm test`) run across all packages

**P0.2 — Base network configuration**
Define and share Base network config (RPC endpoints, chain IDs, block explorer URLs) for both environments used in v0.1.
- [ ] Base Sepolia (testnet) config: RPC URL, chain ID 84532, explorer URL
- [ ] Base mainnet config present but inactive/flagged for production use only
- [ ] Config is a single source of truth in `shared`, imported by `contracts` (Hardhat network config), `backend` (RPC client), and `frontend` (wallet chain-switch target)
- [ ] No hardcoded RPC URLs or chain IDs duplicated across packages

**P0.3 — Hardhat 3 workspace**
- [ ] Hardhat 3 initialized in `contracts` with TypeScript
- [ ] Hardhat Ignition configured for deploy scripts (used again in Phase 5)
- [ ] Test runner configured (Hardhat's native runner or Foundry-compatible, developer's choice) and a trivial passing test exists as a smoke check
- [ ] Network config points at Base Sepolia (from P0.2) plus a local fork for testing

**P0.4 — Next.js 16 app scaffold**
- [ ] App Router structure in `frontend`
- [ ] Tailwind CSS configured
- [ ] shadcn/ui installed and at least one component rendering to confirm setup
- [ ] All dependencies on latest stable versions — no hardcoded/pinned versions without a stated reason

**P0.5 — Privy auth setup**
- [ ] Privy integrated for wallet connect + embedded wallet creation
- [ ] Session handling (login persistence, logout) working end-to-end in a bare page
- [ ] Embedded wallet auto-provisioned for users without an existing wallet

**P0.6 — `TICK` token contract**
- [ ] ERC-20 contract for `TICK`, deployable via Hardhat Ignition
- [ ] Admin/fixed price mechanism (no live market pricing needed for v0.1)
- [ ] Testnet faucet function (rate-limited or admin-gated to prevent abuse) that mints/distributes `TICK` to a caller's address
- [ ] Unit test covering faucet claim limits

---

### Phase 1 — Smart Contracts (Core) — ✅ DEPLOYED (Season 1, Base Sepolia, TickrV01Module)

*Depends on: Phase 0. Unblocks: Phase 2, Phase 3.*

> Architecture supersedes the original per-contract breakdown below (no standalone `FixtureFactory`, `KickoffRevealer`, `RewardDistributor`, or VRF — see §8.5). Nine contracts deployed; addresses in §9.

**P1.0 — `SeasonRegistry`** *(new — not in original plan)*
Owns season lifecycle. Maps `seasonId → {teamRegistry, matchRegistry, startedAt}`. Persistent contracts (`PredictionPool`, `PriceOracle`, `ResultEngine`, `PlayerStats`) never hold a direct reference to a season's `TeamRegistry`/`MatchRegistry` — they resolve it per-call via `getMatchRegistry(seasonId)` / `getTeamRegistry(seasonId)`, so old seasons stay settleable after a new one starts.
- [x] `startNewSeason(teamRegistry, matchRegistry)` registers a season's already-deployed registries and increments `currentSeasonId`
- [ ] Confirm: nothing disables a prior season on `startNewSeason` — verify P1.6/P1.8 correctly resolve historical `seasonId`s for late claims

**P1.1 — `TeamRegistry`** (redeployed per season, e.g. `TeamRegistrySeason1`)
Stores that season's 20-team roster, coin metadata.
- [x] Teams set once at construction, in `packages/shared/src/teams.ts` order, so on-chain `teamId` matches the off-chain roster
- [ ] Confirm price-feed identifier (CoinGecko/Binance ticker mapping) storage location — not seen in `TeamRegistry`; may live off-chain in `shared` only. Flag before Phase 2 (backend needs this mapping)
- [x] `deactivateTeam`/`reactivateTeam` exist as an emergency safety valve (does not remove historical fixtures/results, only blocks future un-generated fixtures) — informational-only in v0.1 since all fixtures generate up front

**P1.2 — `MatchRegistry`** (redeployed per season, e.g. `MatchRegistrySeason1`) — absorbs original P1.2/P1.3/P1.5
Generates fixtures and owns kickoff reveal for the season.
- [ ] Confirm fixture generation: given 20 teams, produces 38 fixtures (home-and-away round robin), deterministic — locate and verify the generation function (constructor vs. separate call)
- [x] Fixture list publicly readable immediately; `kickoffTimestamp: 0, kickoffRevealed: false` until reveal — no plaintext time pre-reveal
- [x] `revealKickoff(fixtureId, kickoffTimestamp)` — `onlyBackend`, reverts on double-reveal (`KickoffAlreadyRevealed`) and outside the 30–120 min bound (`KickoffOutsideLeadTimeBounds`); also bounds-checks against the fixture's own `windowStart`/`windowEnd`
- [x] Betting-open check: always open pre-reveal, closes the instant revealed `kickoffTimestamp` is reached

**P1.3 — `PriceOracle`** *(persistent across seasons)*
Receives backend-submitted start/end snapshots, computes rounded % change and draw rule.
- [ ] Confirm: restricted to authorized backend signer (Phase 4 security review)
- [ ] Confirm: rounded % change computation and equal-value → draw rule match spec exactly
- [ ] Confirm: snapshot submission idempotency / anti-double-submission

**P1.4 — `ResultEngine`** *(persistent across seasons)*
League table + result finalization, keyed by `(seasonId, teamId)`.
- [x] `table[seasonId][teamId]` — points: `POINTS_WIN=3`, `POINTS_DRAW=1`, `POINTS_LOSS=0`
- [x] Calls out to `PredictionPool.settleFixture()` and (per header comment) `MatchRegistry.markSettled()`
- [ ] Confirm idempotent finalization (match can only be finalized once) — not visible in the header scan, verify in `recordResult`/`_applyResult`

**P1.5 — `PlayerStats`** *(persistent across seasons — new standalone contract, not in original plan)*
- [x] `recordOutcome(...)`, `getStats(player)`, `winRateBps(player)` — win/loss record + win-rate for leaderboard
- [ ] Confirm this is called from `ResultEngine` (original plan folded stats into what's now P1.4) and covers everything the leaderboard (P3.9) needs

**P1.6 — `PredictionPool`** *(persistent across seasons)* — absorbs original P1.9 (`RewardDistributor`)
Open parimutuel staking in `TICK`, 3 outcome pools per fixture, keyed `(seasonId, fixtureId)`; pull-based claim merged in directly ("claim() needs the same stake-mapping storage RewardDistributor would" — per in-code rationale).
- [x] Three pools per match (`totalHome`/`totalDraw`/`totalAway`), `ReentrancyGuard` on `stake`/`claim`
- [x] Pool totals readable at any time, no commit-reveal on stakes
- [x] `platformFeeBps` owner-adjustable, hard-capped at `MAX_FEE_BPS = 1_000` (10%); currently `700` (7%)
- [x] `claim()`: winning-pool proportional payout, `distributable = totalPool * (10_000 - fee) / 10_000`; full refund, no fee, if the winning pool had zero stakers
- [ ] Unit test coverage for rounding/dust in payout math — verify exists

---

### Phase 2 — Backend Engine

*Depends on: Phase 1. Unblocks: Phase 3.*

**P2.1 — CoinGecko poller**
- [ ] Polls real-time prices for all 20 roster coins on a defined interval
- [ ] Handles per-coin failures gracefully (one bad response doesn't halt the whole poll cycle)
- [ ] Exposes latest price per coin to the rest of the backend (in-memory cache or lightweight store)

**P2.2 — Binance WebSocket client**
- [ ] Maintains a live WebSocket stream for all tradable pairs among the 20 coins
- [ ] Auto-reconnects on disconnect with backoff
- [ ] Falls back gracefully (and logs/alerts) for any roster coin without a Binance pair — relevant to the Section 4 risk flag

**P2.3 — Price validator**
- [ ] Computes the median of CoinGecko and Binance prices per coin
- [ ] Rejects/flags outliers beyond a defined deviation threshold (threshold value to be set — flag as configurable, not hardcoded)
- [ ] Blocks a snapshot from being submitted if validation fails, with logging for manual review

**P2.4 — Snapshot submitter**
- [ ] Signs and submits validated start/end prices to `PriceOracle` (P1.7) using the authorized backend signer
- [ ] Retries on transient submission failure with backoff (ties into P4's tx queue/nonce management)
- [ ] Logs every submission with the source data used, for auditability

**P2.5 — Kickoff monitor**
- [ ] Watches `MatchRegistry` for fixtures entering their reveal window
- [ ] Triggers `KickoffRevealer` (P1.5) at the correct moment for each fixture
- [ ] Idempotent — does not double-trigger reveal for the same fixture

**P2.6 — Match timer**
- [ ] Tracks match duration from revealed kickoff
- [ ] Triggers the end-price snapshot and result submission (via P2.4 → P1.7 → P1.8) when the match window closes
- [ ] Handles concurrent matches independently (multiple fixtures can be live simultaneously)

**P2.7 — REST + WebSocket API**
- [ ] REST endpoints: fixtures, results, league table, leaderboard, player profile data
- [ ] WebSocket channel(s): live match state (real-time price/score updates) and live pool sizes
- [ ] API surface matches what the frontend phase (Phase 3) needs — cross-check against Phase 3 pages before finalizing routes

---

### Phase 3 — Frontend

*Depends on: Phase 1, Phase 2.*

**Auth & onboarding**

**P3.1 — Privy login**
- [ ] Login via email, social, or wallet
- [ ] Embedded wallet auto-created on first login for users without one
- [ ] Auto-switches connected wallet to Base Sepolia (or prompts to add/switch network if the wallet resists auto-switch)

**P3.2 — First-login flow**
- [ ] Prompts a unique username, validated against on-chain/DB uniqueness before allowing submission
- [ ] Prompts favourite team selection from the 20-team roster (Section 4)
- [ ] Only triggers once per user, ever (per the "one permanent league" rule in Section 3) — not per season, not on every login

**P3.3 — TICK balance + faucet**
- [ ] `TICK` balance visible in the header at all times when logged in
- [ ] Testnet faucet link/action available from the header, calling P0.6's faucet function

**Home page**

**P3.4 — Home page**
- [ ] Shows today's/currently-live matches
- [ ] Shows a quick league table snapshot (not the full table)
- [ ] Shows a top-leaderboard preview
- [ ] CTA linking to the full fixtures page

**Fixtures & results**

**P3.5 — Fixtures calendar**
- [ ] Lists all 38 matches
- [ ] Kickoff displays as "TBA" for any fixture not yet in its reveal window
- [ ] Shows a countdown to each fixture's reveal window once known

**P3.6 — Match page: pre-match**
- [ ] Stake form: outcome selection (Win1/Draw/Win2) + TICK amount input
- [ ] Pool sizes shown and updating live (via P2.7's WebSocket channel)

**P3.7 — Match page: live**
- [ ] Real-time percentage-change bars per team
- [ ] Rounded live score display
- [ ] Match timer showing time remaining in the window

**P3.8 — Match page: post-match**
- [ ] Final score and result displayed
- [ ] Reward claim button wired to `RewardDistributor.claim()` (P1.9)

**Leaderboard**

**P3.9 — Leaderboard page**
- [ ] Ranked by win rate/points
- [ ] Shows username, favourite team, win-loss record per entry

**Player profile**

**P3.10 — Profile page**
- [ ] Accessible at `ticker.website/username`
- [ ] Shows username, favourite team, wins, losses, win rate, leaderboard rank

**P3.11 — Reward claim flow**
- [ ] Shows all claimable rewards across matches for the logged-in user
- [ ] Supports batch claiming across multiple matches in one transaction where feasible

---

### Phase 4 — Integration, Testing & Security

*Depends on: Phase 3. Unblocks: Phase 5.*

**P4.1 — Unit tests**
- [ ] Fixture generation (P1.2) produces correct, deterministic output for the 20-team roster
- [ ] VRF reveal window logic (P1.4/P1.5) rejects calls outside the 30–120 min window
- [ ] Draw threshold/rounding logic (P1.7) matches spec exactly, including edge cases (e.g. rounding boundary values)
- [ ] Reward math (P1.9) covers rounding/dust and platform fee correctness
- [ ] Staking pool integrity (P1.6) — no way to stake after lock, no double-counting

**P4.2 — Integration tests**
- [ ] Full match lifecycle run on a local Base fork: reveal → stake → result → payout, end to end
- [ ] Covers at least one win, one draw, and one multi-staker payout scenario

**P4.3 — Security review**
- [ ] Reentrancy guards verified on all value-moving contract functions (staking, claiming)
- [ ] Access control verified on `PriceOracle` submission (only authorized backend signer)
- [ ] MEV consideration on the reveal window — assess whether reveal timing/ordering can be front-run or sandwiched, and mitigate if so

**P4.4 — E2E tests (Playwright)**
- [ ] Full user journey: login → username/team selection → stake → claim → profile → leaderboard
- [ ] Runs against a test deployment (Base Sepolia + staging backend/frontend)

**P4.5 — Backend reliability**
- [ ] Retry logic for price fetch failures (CoinGecko/Binance) with backoff
- [ ] Transaction queue with proper nonce management for backend-signed submissions (P2.4), preventing nonce collisions across concurrent matches

**P4.6 — Frontend performance**
- [ ] Lighthouse audit passes acceptable thresholds (define thresholds, e.g. performance ≥ 90)
- [ ] WebSocket reconnect logic verified under simulated disconnects
- [ ] Optimistic UI for staking/claiming transactions, with rollback on failure

---

### Phase 5 — Beta Launch

*Depends on: Phase 4.*

**P5.1 — Deploy contracts**
- [ ] All contracts deployed to Base Sepolia via Hardhat Ignition
- [ ] Contracts verified on Base Sepolia's block explorer

**P5.2 — Deploy backend**
- [ ] Deployed to cloud infra (Railway/Render/VPS — developer's choice)
- [ ] Monitoring in place
- [ ] Process management via PM2 (or equivalent) with auto-restart on crash

**P5.3 — Deploy frontend**
- [ ] Deployed to Vercel
- [ ] Custom domain configured (`ticker.website` or confirmed final domain)

**P5.4 — League bootstrap**
- [ ] Fixtures generated (P1.2) for the full 20-team roster
- [ ] All 38 kickoff times sealed via VRF (P1.4)
- [ ] TICK faucet campaign run to onboard beta testers with testnet balance

---

## 6. Phase Dependency Summary

| Phase | Depends on | Unblocks |
|---|---|---|
| 0 — Foundation & Tooling | — | All phases |
| 1 — Smart Contracts (Core) | 0 | 2, 3 |
| 2 — Backend Engine | 1 | 3 |
| 3 — Frontend | 1, 2 | 4 |
| 4 — Integration, Testing & Security | 3 | 5 |
| 5 — Beta Launch | 4 | — |

## 7. Notes for the Coding Agent

- Do not hardcode package versions in `frontend`, `backend`, or `contracts` package.json files unless a specific version is required for compatibility — use latest stable at time of setup.
- Every contract touching value transfer (`PredictionPool`, `RewardDistributor`) requires a reentrancy guard and must pass through the Phase 4 security review before mainnet deployment.
- The reveal-window and parimutuel-staking design intentionally keeps pool sizes public and kickoff times private until reveal — do not "simplify" this by making kickoff times public earlier or by moving to commit-reveal staking; both are explicit design decisions in Section 3.
- Real-value `TICK` staking with a payout is a wagering mechanic. This has no bearing on the technical build, but flag it for the project owner before mainnet/production launch as a compliance item to check against applicable gambling regulation in target jurisdictions.

## 8. Assumptions & Resolved Ambiguities

These points were ambiguous or contradictory in the source notes and have been resolved as follows. Confirm with the project owner if any of these need revisiting:

1. **Chain:** source notes referenced both "Somnia Testnet" (in the original Phase 0/5 task text) and "Base" (in the project intro and a later "Chain confirmed" note). Resolved to **Base** — Base Sepolia for v0.1, Base mainnet for production. All "Somnia Testnet" task text has been rewritten accordingly.
2. **Roster:** an earlier note mentioned "Base removed, replaced with Shiba Inu," which doesn't cleanly map onto the originally-listed roster (which had no "Base" entry and listed "Mantle" at #20). The final roster table provided (Section 4, with Shiba Inu at #20) was treated as authoritative and used as-is.
3. **Team #3 "Somnia":** kept as-is per the final roster — this is the SOMI coin/token, unrelated to the Base chain decision. Called out explicitly in Section 4 to prevent the coding agent from conflating team data with chain config.
4. **Domain:** `ticker.website/username` was taken literally from the source notes as the intended profile URL pattern.
5. **Seasons (resolved 2026-09-24):** the original "no seasons, one permanent league" decision (§1, §3) is superseded by the deployed architecture. `SeasonRegistry` + per-season `TeamRegistry`/`MatchRegistry` are live; `TICK`, `PlayerStats`, `PredictionPool`, `PriceOracle`, `ResultEngine` are season-agnostic/persistent. Deployment is authoritative going forward; spec text updated accordingly throughout.
6. **VRF (resolved 2026-09-24):** dropped in favor of backend-signed `revealKickoff`, on-chain-bounded to 30–120 minutes. Rationale from the contract's own header comment: `PriceOracle` submissions already require trusting the backend signer, so a VRF-free reveal by the same trusted party adds no new trust assumption, while removing the Chainlink VRF subscription/LINK-funding overhead. This does **not** relax the reveal-window or pool-visibility rules in §7 — those still hold.
7. **RewardDistributor (resolved 2026-09-24):** merged into `PredictionPool.claim()` rather than deployed as a separate contract, since claiming needs the same per-player stake mapping `PredictionPool` already owns.
8. **PlayerStats (resolved 2026-09-24):** deployed as its own persistent contract rather than folded into `ResultEngine` as originally planned.

## 9. Deployed Contracts — Season 1 (Base Sepolia, TickrV01Module)

| Contract | Address | Scope |
|---|---|---|
| PlayerStats | `0xac43d2543c6cfaAec5d05316D6C1B1Db2f196540` | persistent |
| PriceOracle | `0xf837801B0401cd65316807F072894bec810C27e4` | persistent |
| SeasonRegistry | `0x77f51dd40450bFb888dFB5afFd90Bc77acC9faa1` | persistent |
| TeamRegistrySeason1 | `0x6b38ac8714190B8F3346C1D0087EDfF390BfD5Fe` | Season 1 |
| TickToken | `0xAD4DeCb4Ea9c65AB170C1aF484362F49829Dbc56` | persistent |
| MatchRegistrySeason1 | `0xa9a2Ed6DeC1AE1be73F8aE8D394597369741BFd2` | Season 1 |
| PredictionPool | `0x91A35dc96aDb15d9eFF149D6D6da14BA2912f1B7` | persistent |
| ResultEngine | `0x8E9F50711B992686199c23EfA6EF62123c30528F` | persistent |

> Address byte-length not independently verified against the deploy log as pasted — recheck against the explorer/artifacts before wiring the backend if any call reverts on an invalid address.

Post-deploy wiring already executed: `MatchRegistrySeason1.setResultEngine`, `PlayerStats.setPredictionPool`, `PredictionPool.setResultEngine`, `PriceOracle.setResultEngine`, `ResultEngine.setPredictionPool`, `ResultEngine.setPriceOracle`, `SeasonRegistry.startNewSeason` (Season 1).
