# Tickr Docs

Standalone documentation app for Tickr. Built with Next.js and React. The pages are maintained in `src/lib/content.ts` so navigation, search and sitemap remain in sync.

## Current coverage

- **Price sources:** Coinbase Exchange is primary; Binance is a fallback and cross-check, followed by CoinGecko. Source freshness, deviation checks and kickoff-source consistency are documented in `/price-sources`.
- **AI agentic Cup commentators:** `/ai-commentators` explains DEE and REKT, five-minute previews, live events, round awareness, post-match callbacks, news context and shareable cards.
- **Commentary operations:** `/commentary-setup` covers the Supabase SQL update, voice configuration, token budgets, template fallbacks, optional trusted news feed and read endpoints. Runtime settings are defined in `../backend/.env.example`; apply `../backend/sql/cup-commentary.sql` to support longer exchanges.
- **World Cup:** `/world-cup` covers the 64-team knockout format and TP leaderboard, which lists all registered profiles.

Adding a page to `src/lib/content.ts` automatically adds it to the sidebar, documentation search and sitemap.

## Local development

From the workspace root:

```sh
pnpm install
pnpm --filter @tickr/docs dev
```

Open `http://localhost:3001`.

## Deployment

Create a new Vercel project from this repository and set its **Root Directory** to `packages/docs`. The local `vercel.json` identifies this as a Next.js app. Do not group it into a Services project with the existing frontend or backend. Set `NEXT_PUBLIC_DOCS_URL=https://docs.tickrbase.top`, then add `docs.tickrbase.top` as the custom domain for this new project and configure the DNS record Vercel provides. The existing frontend and backend deployments are independent.

Content that depends on live configuration should be checked against the backend environment and deployed contracts before release. In particular, price freshness, deviation limits, fee settings and contract addresses can change between deployments.
