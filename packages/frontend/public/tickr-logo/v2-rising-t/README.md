# TICKR Logo Kit — V2 "Rising T"

A lowercase `t` whose stem launches into an upward arrow — **t**ickr,
**t**icker tape, price going **up**, your call **won**. One glyph, the whole
product story. The arrowhead carries the brand blue; the i takes a clean dot.

Tested: legible at 20px in a wallet lineup next to BTC/ETH/SOL, and fully
monochrome-proof (see `tickr-wordmark-mono.svg`).

## Files

| File | Use |
|---|---|
| `tickr-wordmark-dark.svg` | Header / light backgrounds (ink `#0B0F1A`, blue arrow tip) |
| `tickr-wordmark-light.svg` | Header / dark backgrounds (white, blue arrow tip) |
| `tickr-wordmark-mono.svg` | Single-colour reproduction (all ink) |
| `tickr-icon.svg` | App icon source (gradient squircle + white rising-t) |
| `tickr-token.svg` | TICK token logo (gradient coin + white rising-t) |
| `png/tickr-word-dark.png` | Wordmark, transparent, 3777px wide |
| `png/tickr-word-light.png` | Wordmark, transparent, 3777px wide |
| `png/tickr-icon-512.png` / `-192` / `-64` | App icon / PWA |
| `png/tickr-token-512.png` / `-192` / `-64` | Token logo (CoinGecko, wallets, DEX lists) |
| `png/tickr-favicon-32.png` | Browser favicon |

## Brand colours

- Ink: `#0B0F1A` · White: `#FFFFFF`
- TICKR blue: `#2E7CF6` · Arrow gradient: `#5B9BFF` → `#2E7CF6`
- Icon/token background: `#0B1B3D` → `#17468F` → `#2E7CF6`

## Brand architecture note

The check mark from V1 is not discarded — it becomes the *reward* symbol
inside the product: win animations, "prediction correct" states, leaderboard
badges, social flex posts. The check is what users **earn**; the rising-t is
what they **recognise**.

## Frontend wiring (Next.js)

```
packages/frontend/public/brand/tickr-wordmark-light.svg
packages/frontend/app/icon.png        <- png/tickr-icon-512.png
packages/frontend/app/favicon.ico     <- png/tickr-favicon-32.png
```

```tsx
<img src="/brand/tickr-wordmark-light.svg" alt="tickr" className="h-8" />
```
