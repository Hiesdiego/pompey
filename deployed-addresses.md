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

## Market factory

| Status | Address | Deployment block |
| --- | --- | --- |
| Existing markets | `0x915c36ffb6fe3cd65780fcafa2b489ce6eafdca1` | `47568821` |
| New markets | `0xac04f4ff8b2e71984cb25e75456915c81075acdc` | Standalone deployment |

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
