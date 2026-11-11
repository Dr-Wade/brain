# Brain

A Claude connector for an Obsidian vault kept in GitHub. Add
`https://brain.tombre.fr/api/mcp` as a custom connector in Claude, sign in with
GitHub, and Claude can capture ideas into the vault's inbox, search and read
notes, and file GitHub issues — by text or by voice.

## Develop

Needs Node 26, pnpm (the version in `package.json`) and a Postgres (Docker, or
any local Postgres 18 on `POSTGRES_PORT`).

```sh
cp .env.example .env
pnpm install
pnpm db:up && pnpm db:deploy
pnpm dev
```

The app is on the `CLIENT_PORT` from `.env`. `pnpm check` runs lint, typecheck
and tests.

| | |
| --- | --- |
| API | NestJS 12, Prisma 7, better-auth (GitHub, OAuth 2.1 provider for MCP), MCP TypeScript SDK 2, Zod 4 |
| Client | Vue 3.5, PrimeVue 4, Tailwind 4, vue-i18n |
| Tests | Vitest 5, Playwright |
| Deploy | Docker images on GHCR, Dokploy |

See [`CLAUDE.md`](CLAUDE.md) for how it fits together and how it is deployed.
