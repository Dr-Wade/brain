# Brain

## Develop

Needs Node 26, pnpm (the version in `package.json`) and Docker.

```sh
cp .env.example .env
pnpm install
pnpm db:up && pnpm db:migrate
pnpm dev
```

The app is on the `CLIENT_PORT` from `.env`, the API's documentation on
`/api/docs`. `pnpm check` runs lint, typecheck and tests.

| | |
| --- | --- |
| API | NestJS 12, Prisma 7, better-auth, BullMQ 6, Zod 4 |
| Client | Vue 3.5, PrimeVue 4, Tailwind 4, TanStack Query, vue-i18n |
| Tests | Vitest 5, Playwright |
| Deploy | Docker images on GHCR, Dokploy |

See [`CLAUDE.md`](CLAUDE.md) for the conventions and how a resource is added.
