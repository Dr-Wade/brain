# Starter

<!-- starter:begin -->
A template for a new project on the [handbook](https://github.com/Dr-Wade/handbook)'s
stack, with a small to-do app that runs through every layer: Prisma model, NestJS
module, Zod contract, OpenAPI, generated client, TanStack Query, PrimeVue page, a
BullMQ job, and tests at each level.

Start a project from it: `gh repo create <owner>/<name> --template Dr-Wade/starter`,
then `pnpm install && pnpm init-project <name>`. [`CLAUDE.md`](CLAUDE.md) has the
whole procedure, and an agent can follow it on its own.
<!-- starter:end -->

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
