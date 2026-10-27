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

Deploy `packages/docs` as its own Next.js application using the monorepo root as the install directory and `packages/docs` as the project root. Set `NEXT_PUBLIC_DOCS_URL` to the public origin, for example `https://docs.tickrbase.top`, before building. Add the `docs` DNS record and custom domain in the host once deployed.

Content that depends on live configuration should be checked against the backend environment and deployed contracts before release. In particular, price freshness, deviation limits, fee settings and contract addresses can change between deployments.
