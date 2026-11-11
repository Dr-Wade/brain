# Brain — agent notes

The stack, CI and deploy conventions are the handbook's (`~/repos/handbook`:
`stack.md`, `ci.md`, `deploy.md`). Read the relevant one before changing the
stack, a workflow or the deploy. This file records what is specific to this
code, and where it departs from the handbook.

## What it is

A remote MCP server ("custom connector") that lets Claude — the web and phone
apps, voice mode included — work on Edward's vault: an Obsidian vault in the
private repo `Dr-Wade/vault` (its own `CLAUDE.md` holds the vault's
conventions). Served at `https://brain.tombre.fr`, the connector URL is
`https://brain.tombre.fr/api/mcp`.

Tools (`services/api/src/mcp/tools.ts`):

| Tool | Does |
| --- | --- |
| `capture_idea` | One new file in `Inbox/` per idea, the words verbatim, one commit each |
| `search_notes` | Keyword search over the vault's Markdown, accents and case ignored |
| `read_note` | One note's full text |
| `list_inbox` | What waits to be sorted |
| `file_for_atlas` | A GitHub issue on a repo in `ISSUE_REPOS`, **never labelled**: Atlas builds anything labelled `ready` |
| `upcoming_meetings` | The coming meetings from the published calendar, with their prep notes |

Two more doors into the vault, both in this service:

- **The Brain Telegram bot** (`@drwade_brain_bot`, `telegram/`): anything Edward sends or
  forwards becomes an inbox note (`source: telegram`); voice notes are kept as audio in
  `Attachments/` and transcribed by Deepgram; forwards arriving within 30 s of the last capture
  join its note. `/find`, `/inbox`, `/next`. It answers only `TELEGRAM_ALLOWED_USER_ID`, in
  private.
- **Meeting prep** (`meetings/`): once a day (`MEETINGS_RUN_AT`), the published calendar
  (`CALENDAR_ICS_URL`, Outlook's ICS) gives the coming meetings; each one gets
  `Meetings/<date> <time> <title>.md` as soon as it is within its rule's days
  (`Meetings/Rules.md`, a table Edward edits), with the previous meeting of the series and its
  open actions. The bot announces each note once, and the day before says how far the prep got.

Single user. Sign-in is GitHub only, and only for `ALLOWED_GITHUB_ID`
(Edward's numeric id, 38118787); unset, nobody gets in.

## How it fits together

- **GitHub is the vault's truth.** Writes go through the contents API (create
  only, never overwrite: a taken name gets " (2)"). Reads come from a tarball
  of the branch head, parsed once per commit and kept in memory; the head is
  re-checked at most every 15 s and right after a capture
  (`vault/vault.service.ts`). No database row holds a note.
- **The database holds auth only**: better-auth's tables plus the OAuth 2.1
  provider's (`jwt` + `@better-auth/mcp`). Claude registers itself (dynamic
  client registration), the user signs in with GitHub and consents once,
  Claude gets a JWT access token whose audience is `/api/mcp`.
- **`/api/mcp` is guarded by the bearer token, not the session cookie**
  (`@AllowAnonymous()` on the controller; `requireMcpAuth` checks signature,
  issuer, audience and expiry). Stateless: one MCP server per request.
- **Discovery lives at the root, outside `/api`.** `setup-app.ts` hands every
  `/.well-known/*` request to better-auth, whose plugins answer
  `/.well-known/oauth-protected-resource/api/mcp` and
  `/.well-known/oauth-authorization-server/api/auth` (bare forms rewritten to
  those). **The reverse proxy must route `/.well-known` to the API**, like
  `/api`.
- **The client is three pages**: sign-in (GitHub button), consent, and a home
  page with the connector URL. The `oauthProviderClient` plugin carries
  Claude's signed authorization request through sign-in and consent.

## Where this departs from the handbook

- **No worker for the webhook or the daily pass.** The handbook sends webhooks and batch jobs
  through BullMQ to a worker. Here Telegram is the queue: the webhook is registered with
  `max_connections: 1` and answers only once the note is saved, so a failure (GitHub down) is a
  500 and Telegram delivers the update again; after three tries the bot says it gave up. The
  daily pass is a timer in the API, made safe to repeat by `sent_reminders` (one row per pass
  and per reminder) and by notes being create-only. One user, a few messages a day: a Redis and
  a second container would cost more than they protect.

## Gotchas

- **`resources` is declared in full in `mcp()`** with `allowedScopes`: the
  plugin otherwise seeds a resource with `allowedScopes: null`, which Prisma
  cannot store (a PostgreSQL list is never null). Startup logs the failure and
  retries forever if this is removed.
- **"json" fields of the OAuth tables are `String` columns**: the Prisma
  adapter stringifies them (no JSON support declared). Arrays are native.
- **`/api/auth/token` is disabled** (`disabledPaths`) and the `jwt` plugin
  sets no header, so a session JWT can never pass as an MCP access token.
- **The authorize endpoint answers JSON to fetch-style requests** and redirects
  only browser navigations (`sec-fetch-mode`). Node's `fetch` always sends
  `sec-fetch-mode: cors`; the integration test uses `node:http` for that call.
- **Blocking other GitHub accounts happens in `getUserInfo`**: returning null
  fails the callback with `unable_to_get_user_info` before any user row is
  created. The sign-in page shows that error as "not allowed".
- **better-auth packages are pinned to the newest release older than a day**
  (`minimumReleaseAge` in `pnpm-workspace.yaml`): pnpm refuses fresher ones.

- **A message forwarded from a group carries its author, never the group**: Telegram does not
  tell bots where a forward came from, except for channel posts (which get a `t.me` link).
- **Outlook names its zones the Windows way** ("Romance Standard Time"): `calendar.ts`
  registers the feed's own VTIMEZONE blocks before reading any date. Outlook's published feed
  has titles, places and descriptions, but no attendees.
- **The calendar link and the bot token are secrets**: anyone holding the ICS link reads the
  calendar. Neither is ever logged (errors give the status, not the URL).
- **A moved meeting gets a new prep note** (the path holds the date); the old one stays.

## Layout

| Path | What |
| --- | --- |
| `packages/schemas` | Zod schemas shared by the API and the client (`/api/config`). |
| `packages/database` | Prisma schema (auth and OAuth tables), migrations, the generated client. |
| `packages/logger` | pino options. |
| `services/api` | NestJS 12: `auth/` (better-auth, GitHub, OAuth provider), `mcp/` (endpoint and tools), `vault/` (GitHub-backed vault), `telegram/` (the bot), `meetings/` (calendar and prep notes). |
| `services/client` | Vue 3 SPA: sign-in, consent, home. |
| `e2e/` | Playwright: Claude's authorization reaching the sign-in page. |

No worker, no Redis: see "Where this departs from the handbook".

## Commands

```sh
pnpm db:up              # Postgres in Docker, on the project's own port
pnpm db:migration <name> # a migration from the schema, without prompts; then pnpm db:deploy
pnpm dev                # builds the packages, then watches everything
pnpm check              # lint + typecheck + tests: before every commit
pnpm openapi            # after changing an endpoint: re-export the spec, regenerate the client SDK
pnpm build && pnpm e2e  # Playwright, against vite preview and the built API
```

Without Docker (WSL without Desktop integration), any local Postgres 18 on
`POSTGRES_PORT` with a `brain` database works the same.

Trying the tools by hand: the MCP Inspector (`npx @modelcontextprotocol/inspector`)
against `http://localhost:4691/api/mcp` runs the whole OAuth flow, given a
GitHub OAuth app whose callback is `http://localhost:4691/api/auth/callback/github`.

## Conventions that are not obvious from the code

- **Every constructor parameter has `@Inject(Token)`**, or the provider is a
  factory (`VaultService`: its extra parameters are test seams). Vitest (oxc)
  emits no decorator metadata.
- **The API runs its `tsc` output in development too** (Swagger needs
  `design:paramtypes`).
- **Generated, never edited:** `services/client/src/api/` and
  `services/api/openapi.json`; CI fails when they are stale.
- **Configuration is read on first use** (`AppConfig`). A new variable goes in
  the Zod schema there and in `.env.example`. The vault and the issue tool do
  nothing when unconfigured: the tools answer "not configured" as tool errors.
- **Expected failures are tool errors, not exceptions** (`answer()` in
  `tools.ts`): the model can explain them. Anything else throws.
- **Same origin everywhere.** The client calls `/api/...`.
- **i18n:** every string goes through `t()`, in `en.json` and `fr.json`.
- **Formatting is the linter's** (`@drwade/eslint-config`): `pnpm lint:fix`.

## Versions held back on purpose

| What | Held at | Why | Lift when |
| --- | --- | --- | --- |
| PrimeVue, `@primeuix/themes`, `primeicons` | 4 / 2 / 7 | Their next majors are no longer MIT. | A deliberate decision to license, or to change library |
| Root `typescript` | 6.0 | typescript-eslint supports < 6.1. The workspaces use 7. | typescript-eslint supports TypeScript 7 |
| `vue-tsc` via `scripts/vue-tsc.mjs` | — | vue-tsc needs a JavaScript compiler TypeScript 7 does not ship. | vue-tsc runs on TypeScript 7 |
| `@hey-api/openapi-ts` | a `next` snapshot | 0.99.0 crashes on TypeScript 7. | A stable release supports TypeScript 7 |

No Renovate: the starter's config was dropped, so dependency updates are a
deliberate pass, not weekly PRs.

## CI and deploy

Public repo: Actions minutes are free, so the handbook's pipeline runs as is.

- `pr-check.yml`: one job, only what the PR touches.
- `build.yml`: the full suite with coverage and E2E, on every push to `main`
  (through `deploy.yml`) and on a PR labelled `full-ci`.
- `deploy.yml`: after the suite, one image per changed service
  (`docker build --target api|client`) to `ghcr.io/dr-wade/brain/<service>`,
  then a Dokploy redeploy. Variables `DOKPLOY_URL`, `DOKPLOY_API_APP_ID`,
  `DOKPLOY_CLIENT_APP_ID`, secret `DOKPLOY_TOKEN`. Without `DOKPLOY_URL` it
  stops after the suite.

Dokploy (the tombre server), project "Brain": a Postgres, an `API` app
(image `ghcr.io/dr-wade/brain/api:latest`, port 3000) and a `Client` app
(`ghcr.io/dr-wade/brain/client:latest`, port 80). Domain `brain.tombre.fr`:
`/api` **and `/.well-known`** to the API, everything else to the client.
The API takes `DATABASE_URL`, `APP_URL=https://brain.tombre.fr`,
`BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`,
`ALLOWED_GITHUB_ID`, `VAULT_REPO`, `VAULT_TOKEN`, and optionally `ISSUE_REPOS`,
`ISSUE_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_USER_ID`,
`DEEPGRAM_API_KEY`, `CALENDAR_ICS_URL`, `SENTRY_DSN`. It applies pending migrations when it
starts, registers the Telegram webhook (production only), and runs the meeting pass at
`MEETINGS_RUN_AT` (and at start, when that hour has passed and today's pass has not run).

The workflow's `DOKPLOY_TOKEN` is a Dokploy API key of its own,
`github-actions-brain`: revoke it in Dokploy to cut the pipeline off without
touching anything else. It is created with `rateLimitEnabled: false`: a key
created through Dokploy's API otherwise allows 10 requests a day, and one
deploy with its status polling spends about five; past that, the deploy
action reports a 401. The GHCR packages `brain/api` and `brain/client` must
be public: Dokploy pulls them without credentials.
