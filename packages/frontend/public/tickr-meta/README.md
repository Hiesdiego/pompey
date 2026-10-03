# TICKR Metadata Kit — favicons, PWA, social cards

Everything the browser / OS / social crawler needs to recognise TICKR.
All art is the V2 "rising t".

## Where each file goes (paths are inside `packages/frontend/`)

| This file | Goes to |
|---|---|
| `public/favicon.ico` | `packages/frontend/public/favicon.ico` (multi-size 16/32/48 ICO) |
| `public/manifest.webmanifest` | `packages/frontend/public/manifest.webmanifest` |
| `public/icons/icon-192.png` | `packages/frontend/public/icons/icon-192.png` |
| `public/icons/icon-512.png` | `packages/frontend/public/icons/icon-512.png` |
| `public/icons/maskable-512.png` | `packages/frontend/public/icons/maskable-512.png` (safe-zone padded for Android adaptive icons) |
| `public/icons/apple-touch-icon.png` | `packages/frontend/public/icons/apple-touch-icon.png` (180×180, opaque — iOS rounds it itself) |
| `public/og/og-card.png` | `packages/frontend/public/og/og-card.png` (1200×630 social share card) |
| `src/app/layout.tsx` | `packages/frontend/src/app/layout.tsx` (**replaces** the existing file — complete copy) |

## What the layout carries

- `metadata`: title template (`"%s — TICKR"`), description, `manifest`,
  icon set (ICO + 192 PNG + SVG), Apple touch icon, Open Graph + Twitter
  large-image cards pointing at `/og/og-card.png`
- `viewport` export (Next 14+ convention): `themeColor #0B1B3D`,
  `colorScheme: dark light`

## Notes

- The old `icons.apple` entry pointed at the transparent squircle 192px —
  replaced with the opaque 180px apple-touch-icon (transparent corners
  render black on iOS home screens).
- `maskable-512.png` has the mark inset to ~62% so Android's adaptive-icon
  masks never clip the arrowhead.
- No new packages needed. After copying the files, rebuild the frontend
  (`pnpm --filter @tickr/frontend build`) — Next.js picks up
  `manifest.webmanifest` from `public/` automatically, no route needed.
- PWA installability also needs HTTPS + a service worker for offline;
  this kit covers identity/metadata — the install prompt will appear once
  a service worker is registered.
