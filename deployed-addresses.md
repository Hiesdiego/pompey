# Tickr Contract Addresses

Deployment reference for the Tickr contracts on **Base Sepolia**. Addresses are shown exactly as recorded; preserve the checksum casing when copying them into configuration.

## Deployed contracts

| Contract | Address | Deployment label |
| --- | --- | --- |
| PlayerStats | `0x6d48c38c2036b3d31328b48bd8b72785ab2d15a9` | `TickrV03Module` |
| PriceOracle | `0x2814bd64f7774eccd5dc11a792f15fecdfebdf90` | `TickrV03Module` |
| SeasonRegistry | `0xe6f2c8a55a3f4f34a7abd833afece63d9789c260` | `TickrV03Module` |
| TeamRegistrySeason1 | `0x9f7c234dca6c48c9d16dfe7388b580de6c0d67f6` | `TickrV03Module` |
| TickToken | `0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b` | `TickrV02Module` |
| MatchRegistrySeason1 | `0x15db82e7ec238a4bd32cc3325b300f155d07ee2e` | `TickrV03Module` |
| PredictionPool | `0xc47358e69d145f94728796a337ec14401641700f` | `TickrV03Module` |
| ResultEngine | `0x82e00f543ddf320eec4447fd16810852bda4ec12` | `TickrV03Module` |

## Cup tournament (Base Sepolia)

Deployed and wired on **October 17, 2026**. The deployer is the owner; treasury and operator use the same address.

| Role / contract | Address |
| --- | --- |
| Deployer / owner | `0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf` |
| TICK token | `0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b` |
| Treasury | `0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf` |
| Operator | `0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf` |
| CupRegistry | `0x45b8f0ef96b919184659bee98c7503834d167238` |
| CupEngine | `0xe22c3b9bd80ae591d8ef3da6f208b05b2913752f` |
| DisputeBallot | `0x5649588288c98abdca6bcb7eb767a1611ca32179` |
| CupPool | `0x9b2527c88f806fe34c166edb4784f60483b0864b` |

All four contracts are wired, and the 64-team field is registered (16 teams per pot). The draw and pool seeding are pending. Before the November 1 tournament start, approve TICK spending and call `CupPool.seedMatchPools(0, 63)` and `CupPool.seedOutright()`. For the October 30 draw ceremony, call `CupRegistry.requestDraw()`, then `executeDraw()` after at least 100 blocks. The backend must reveal Round of 64 kickoffs with at least one hour of lead time (24 hours for openers).

## Stock League (Base Sepolia)

Active Season 1 is the 12-team deployment. TickToken is reused from the crypto league; the stock deployment does not alter crypto contract addresses. The schedule contains 22 rounds and 132 fixtures, and all fixtures have been seeded at 250 TICK each (33,000 TICK total).

| Contract / role | Active 12-team deployment |
| --- | --- |
| TICK token | `0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b` |
| StockPriceOracle proxy | `0xd0620e22ef3063d31067e23d11c4436b36952615` |
| StockResultEngine proxy | `0x6dd6131a02dfebc211cadacd1f15324a841d7d55` |
| StockPredictionPool proxy | `0xd36fc87d56fb838e7c48cc22a761f7ec76401a49` |
| StockTeamRegistry proxy | `0x7c506a895d84363af3a63e730cbf4fa0b956cf1b` |
| StockMatchRegistry proxy | `0x1f5be62901e7cb2981ef70ede824c34a303aedbe` |
| Backend signer / treasury | `0x5219d14dFbCF0be6EC00D6B5188fFF353aeb33BF` |

The old 22-team deployment remains on-chain and untouched. Do not use its addresses for the active season; in particular, its prediction pool is `0xbb270e85c0c0de720290f5d90f4f8a0e6005a4da` and its match registry already contains 231 fixtures.

## Stock Price Target Market Factory (Base Sepolia)

Deployed on November 19, 2026 at block 61011943 (proxy creation transaction `0xd94e19c6a025ee5fe36ac4b5d3f23f26a8f99f35fb518f046e74c8249251dc35`). Proxy initialized atomically; deploy script verified all three configured dependencies after deployment.

| Contract / role | Address |
| --- | --- |
| StockMarketFactory implementation | `0x1acebd39109cabf02bdcbc616c1d191d8c1b92bd` |
| StockMarketFactory proxy | `0x8b7673bb0f04bc52b3f7f8b622969b6be5df3e0c` |
| TICK token (reused) | `0xD7DAd21d5e61f398c88dA6d15b5CD03f6bBc499b` |
| Treasury / resolver / owner | `0x5219d14dfbcf0be6ec00d6b5188fff353aeb33bf` |

The stock price-target factory is separate from the crypto MarketFactory and the stock league. Market creation adds a 250 TICK seed; a featured market must be created with explicit stock, direction, target and deadline terms before the seed enters its pool.

Featured market seeded on November 19, 2026:

| Market ID | Question | Seed | Creation transaction | Block |
| --- | --- | --- | --- | --- |
| `0` | Will NVDAc be above $180.00 by December 20, 2026 at 23:59 UTC? | `250 TICK` | `0x60e3769bb51db201616e1406a9be418c81c55753e308b9a8ed1b674c76c8210a` | `61025190` |

## Market factory

| Status | Address | Deployment block |
| --- | --- | --- |
| Existing markets | `0x915c36ffb6fe3cd65780fcafa2b489ce6eafdca1` | `47568821` |
| Previous markets (`n-` links) | `0xac04f4ff8b2e71984cb25e75456915c81075acdc` | Standalone deployment |
| New price-target markets (`v-` links) | `0x7ead4c6b3cc884adb82b60e9c34ef2d59604bfc2` | Standalone deployment |

## Deployment record

The recorded Ignition deployment ran `TickrV01Module` in three batches:

1. **Core contracts:** `PlayerStats`, `PriceOracle`, `SeasonRegistry`, `TeamRegistrySeason1`, and `TickToken`.
2. **Season and game contracts:** `MatchRegistrySeason1`, `PredictionPool`, and `ResultEngine`.
3. **Wiring and startup:** configured the contract references and started Season 1.

Post-deployment calls recorded as successful:

- `MatchRegistrySeason1.setResultEngine`
- `PlayerStats.setPredictionPool`
- `PredictionPool.setResultEngine`
- `PriceOracle.setResultEngine`
- `ResultEngine.setPredictionPool`
- `ResultEngine.setPriceOracle`
- `StartSeason1`

> **Label note:** The deployment output says `TickrV01Module` ran, while the address list labels most contracts `TickrV03Module` and `TickToken` `TickrV02Module`. These labels are retained as recorded; verify against the deployment artifacts when tracing a specific release.
