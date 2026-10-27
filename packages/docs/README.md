# Tickr Docs

Standalone documentation app for Tickr. Built with Next.js and React. The pages are maintained in `src/lib/content.ts` so navigation, search and sitemap remain in sync.

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
