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

## Market factory

| Status | Address | Deployment block |
| --- | --- | --- |
| Current | `0x915c36ffb6fe3cd65780fcafa2b489ce6eafdca1` | `47568821` |

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
