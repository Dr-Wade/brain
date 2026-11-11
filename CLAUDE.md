# Starter — agent notes

The stack, CI and deploy conventions are the handbook's (`~/repos/handbook`:
`stack.md`, `ci.md`, `deploy.md`). Read the relevant one before changing the
stack, a workflow or the deploy. This file records what is specific to this
code, and where it departs from the handbook.

<!-- starter:begin -->
## Starting a project from this

This repository is a template. A new project is a copy of it, made once; it
gets none of the starter's later changes. Work through these steps in order,
then replace this whole section (down to the `starter:end` marker) with the
project's own notes.

1. **Create and initialise.** Create the repository from the template in the
   organisation the user names, and ask whether it is private: a private repo
   pays for its CI minutes.

   ```sh
   gh repo create <owner>/<name> --template Dr-Wade/starter --private --clone
   cd <name> && pnpm init-project <name> "Display name"
   ```

   `init-project` renames the `@starter/*` packages, the queue prefix, the
   database and the titles, picks a port band from the name, removes
   README's template blurb, runs `pnpm install`, lists what still says
   "starter", and deletes itself. It writes the display name into both
   locales: translate `app.name` in `fr.json` if it should differ.
2. **The worker.** Keep it only for slow work (mail, imports, webhooks,
   batch jobs). To remove it:
   - delete `services/worker`, `packages/queues`,
     `services/api/src/queues.module.ts` and
     `services/api/src/todos/todo-reminders.service.ts`;
   - `services/api`: drop `@nestjs/bullmq`, `bullmq`, `ioredis` and the
     queues package from `package.json`; `RedisModule` from `app.module.ts`;
     the Redis probe from `health/health.module.ts`; `REDIS_URL` from
     `config/app-config.ts`; the reminder calls and the `QueuesModule` import
     in `todos/`; the reminder test in `todos.integration.spec.ts`;
   - `Dockerfile`: the worker and queues `COPY` lines, the worker
     `pnpm deploy`, the `worker` target, the queues import in the API's check;
   - `deploy.yml`: the `worker` filter (and `DOKPLOY_WORKER_APP_ID` in the
     notes below); `docker-compose.yaml`: the `redis` service; workflows:
     `REDIS_URL`; `package.json`: `dev:worker`; `vitest.config.ts`: `worker`
     in the include glob; `pnpm-workspace.yaml`: `msgpackr-extract`;
     `.env.example`: `REDIS_URL`, `REDIS_PORT` and `SMTP_*`;
   - this file and README: every paragraph about the worker, queues or Redis.

   Then `git grep -inE "worker|queue|redis|bullmq|smtp"` must show only
   what you meant to keep.
3. **The todo example.** Keep it as the reference until the first real
   resource works, then remove it:
   - `packages/schemas/src/todos.ts` and `todos.spec.ts`, and their export in
     `packages/schemas/src/index.ts`;
   - the `Todo` model and the `todos` relation on `User` in `schema.prisma`,
     then a migration that drops the table (`pnpm db:migration drop-todos`);
     the `Todo` export in `packages/database/src/index.ts`;
   - `services/api/src/todos/` and `TodosModule` in `app.module.ts`;
   - the client's `TodosPage.vue`, `TodoItem.vue` and `TodoItem.spec.ts`, the
     `todos` route in `router.ts`, the `todos` keys in both locales;
   - `e2e/todos.spec.ts` (replace it: `git rm` of the last spec removes `e2e/`);
   - `pnpm openapi` to regenerate the spec and the client;
   - **rewrite "Adding a resource" below** against the new resource, and every
     other mention of todos in this file.

   Then `git grep -il todo` must show only migration history (never edit an
   applied migration) and the generated client.
4. **`renovate.json`.** It keeps the starter current. In a project, each
   Renovate PR runs the PR check: keep it only if the user wants that.
5. **Prove it.** `cp .env.example .env && pnpm db:up && pnpm db:deploy`, then
   `pnpm check`, `pnpm test:coverage` (the full suite's thresholds, which
   `check` does not run), `pnpm build && pnpm e2e`, and
   `docker build --target api .` (and each other target).
6. **Replace this section** with the project's own notes: what it is for,
   its domain vocabulary, its environments, and anything here it does
   differently.
7. **Before the first push**, say what it will cost (see the handbook's
   `ci.md`): on a private repo every push to a PR or to `main` is a billed run.
<!-- starter:end -->

## Layout

| Path | What |
| --- | --- |
| `packages/schemas` | Zod schemas: the API contract, imported by the API (validation, OpenAPI) and the client (forms). |
| `packages/database` | Prisma schema, migrations, the generated client (`src/generated`, not committed). |
| `packages/queues` | Queue names, job payloads, `QUEUE_PREFIX`, the Redis client factory. |
| `packages/logger` | pino options shared by the API, the worker and scripts. |
| `services/api` | NestJS 12, `/api/*`. Swagger at `/api/docs`. |
| `services/worker` | NestJS application context running the BullMQ processors. No HTTP. |
| `services/client` | Vue 3 SPA: PrimeVue 4, Tailwind 4, TanStack Query, the generated SDK in `src/api`. |
| `e2e/` | Playwright journeys against the built client and the real API. |

## Commands

```sh
pnpm db:up              # Postgres + Redis in Docker, on the project's own ports
pnpm db:migrate         # prisma migrate dev: a migration from the schema, interactive
pnpm db:migration <name> # the same SQL without prompts, for agents; then pnpm db:deploy
pnpm dev                # builds the packages, then watches everything
pnpm check              # builds the packages, then lint + typecheck + tests: before every commit
pnpm openapi            # after changing an endpoint: re-export the spec, regenerate the client SDK
pnpm build && pnpm e2e  # Playwright, against vite preview and the built API
```

The API and the client run on the ports in `.env`; the dev server proxies
`/api` to the API, the way the reverse proxy does in production. One `.env` at
the root serves every service.

## Adding a resource

Copy the shape of `todos`, one layer at a time:

1. **Contract.** Zod schemas in `packages/schemas`, each with
   `.meta({ id: "Name" })`: the id names it in the OpenAPI document and in the
   generated client.
2. **Table.** A model in `schema.prisma`, then a migration. A person runs
   `pnpm db:migrate --name <what>`; an agent runs `pnpm db:migration <what>`
   (writes the SQL from the schema, without prompts) and then `pnpm db:deploy`.
   `migrate dev` prompts whenever data would be lost, and Prisma refuses
   `migrate reset` from an agent without the user's consent: ask, never set
   the consent variable yourself. A migration must leave the previous release
   working (add, backfill, remove later).
3. **API.** A module with a thin controller and a service. Parameters take
   their schema (`@Body({ schema: X })`, `@Param("id", { schema: z.uuid() })`):
   Nest's built-in `StandardSchemaValidationPipe` validates them and Swagger
   documents them. Responses declare theirs with
   `@ApiOkResponse({ standardSchema: X })`. Map rows to the response type
   explicitly (`toTodo`): dates become ISO strings, internal columns stay out.
4. **Scope.** Every query names its owner in the `where` (`{ id, userId }`).
   Another user's row must answer exactly like a missing one: 404.
5. **Client.** `pnpm openapi`, then use the generated `xxxOptions()` /
   `xxxMutation()` with TanStack Query. Forms use `useForm` with the contract's
   schema and `FormField` for the label, hint and error wiring (a PrimeVue
   `Select` takes `aria-labelledby` from its `labelId`).
6. **Tests.** Service logic against the real database through HTTP
   (`todos.integration.spec.ts`); components against props and events
   (`TodoItem.spec.ts`); Playwright only for a journey across pages.

## Conventions that are not obvious from the code

- **Every constructor parameter has `@Inject(Token)`.** Vitest (oxc) emits no
  decorator metadata, so Nest could not resolve types without it.
- **The API runs its `tsc` output in development too.** Swagger reads route
  parameters from `design:paramtypes`, which only `tsc` emits; under tsx or
  esbuild, `/api/docs` and `openapi.json` would lose every body and path
  parameter.
- **Generated, never edited:** `services/client/src/api/` and
  `services/api/openapi.json`. Both are committed, so the client builds
  without a running API; CI fails when they are stale.
- **Configuration is read on first use** (`AppConfig`, `WorkerConfig`). A new
  variable goes in the Zod schema there and in `.env.example`. Optional
  integrations (Sentry, SMTP) do nothing when unset, so the app boots and tests
  run with an empty environment. Production refuses to start without
  `BETTER_AUTH_SECRET`.
- **One Redis client per process**, created by `createRedisClient` and closed
  on shutdown. BullMQ 6 in an ES module cannot build its own from options.
- **Every queue and worker uses `QUEUE_PREFIX`.** Through
  `BullModule.forRootAsync`, never a bare `new Queue()`. On a shared Redis, two
  projects without their own prefix take each other's jobs.
- **Jobs are wake-up calls; the database is the truth.** A processor re-reads
  the row and does nothing if it changed since the job was queued.
- **Same origin everywhere.** The client calls `/api/...`; no API URL is
  baked into a build. Runtime settings come from `GET /api/config`.
- **i18n:** every string goes through `t()`, in `en.json` and `fr.json`. Zod's
  messages follow the same locale.
- **Formatting is the linter's** (`@drwade/eslint-config`): `pnpm lint:fix`.

## Versions held back on purpose

| What | Held at | Why | Lift when |
| --- | --- | --- | --- |
| PrimeVue, `@primeuix/themes`, `primeicons` | 4 / 2 / 7 | Their next majors are no longer MIT (PrimeUI licence, a key per project). Renovate will not propose them. | A deliberate decision to license, or to change library |
| Root `typescript` | 6.0 | typescript-eslint runs from the root and supports < 6.1. The workspaces use 7. | typescript-eslint supports TypeScript 7 |
| `vue-tsc` via `scripts/vue-tsc.mjs` | — | vue-tsc patches the JavaScript compiler, which TypeScript 7 does not ship; the script hands it `@typescript/typescript6`. | vue-tsc runs on TypeScript 7: call it directly |
| `@hey-api/openapi-ts` | a `next` snapshot | 0.99.0 crashes on TypeScript 7 (`ts.SyntaxKind` is gone). | A stable release supports TypeScript 7 |

## CI and deploy

Shaped by the handbook's `ci.md` and `deploy.md`:

- `pr-check.yml`: one job, only what the PR touches, no coverage, no E2E.
- `build.yml`: the full suite, with coverage thresholds and E2E. Runs on every
  push to `main` (through `deploy.yml`) and on a PR labelled `full-ci`.
- `deploy.yml`: after the full suite, one image per changed service
  (`docker build --target api|worker|client`) to
  `ghcr.io/<owner>/<repo>/<service>`, then a Dokploy redeploy. It needs the
  variables `DOKPLOY_URL`, `DOKPLOY_API_APP_ID`, `DOKPLOY_WORKER_APP_ID` and
  `DOKPLOY_CLIENT_APP_ID`, and the secret `DOKPLOY_TOKEN`. Without
  `DOKPLOY_URL` it stops after the suite.

In Dokploy, one application per service, its source the image's `latest` tag.
The domain routes `/api` to the API on port 3000, everything else to the client
on port 80. The API and the worker take `DATABASE_URL`, `REDIS_URL` and
`APP_URL`; the API also takes `BETTER_AUTH_SECRET` (and optionally `SENTRY_DSN`,
`SENTRY_CLIENT_DSN`), the worker the `SMTP_*` variables. The API applies
pending migrations when it starts.
