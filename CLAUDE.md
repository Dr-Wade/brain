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
| `read_note` | One note's full text, by path or by title |
| `list_inbox` | What waits to be sorted |
| `list_notes` | One folder's notes and subfolders |
| `open_tasks` | Unticked `- [ ]` lines by note (templates and archive aside); `until` keeps those due by a day |
| `add_task` | Edward's to-dos into `Tasks.md`, each with its day (`📅 2026-11-18`); Claude asks for when first |
| `complete_task` | Ticks an open task anywhere by its words (`- [x] … ✅ <today>`) |
| `reschedule_task` | Gives open tasks another day, or none |
| `read_attachment` | A file a note embeds: a photo as an image (scaled to fit), a PDF or text file as its text |
| `create_note` | A new note at a path, frontmatter added; never overwrites |
| `edit_note` | Exact passages replaced, each found once (whitespace-tolerant); all or none |
| `append_to_note` | Markdown at the end of a note or of a section by heading |
| `move_note` | Move or rename, wikilinks following; leaving the inbox, the frontmatter becomes a note's |
| `delete_note` | Inbox notes only; elsewhere notes move to `Archive/` |
| `file_for_atlas` | A GitHub issue on a repo in `ISSUE_REPOS`, **never labelled**: Atlas builds anything labelled `ready` |
| `upcoming_meetings` | The coming meetings from the published calendars, with their prep notes |

The connector's instructions (`INSTRUCTIONS` in `tools.ts`) end with `Glossary.md`'s list lines
(`vault/glossary.ts`): the names Edward uses, so Claude spells them right and catches dictation
errors. They are read from the snapshot on every MCP request, so an edit to the glossary reaches
the next conversation.

The vault's conventions are enforced in `vault/editing.ts`, not left to the model: paths stay
Markdown outside hidden folders (so never `.github/workflows`), `Archive/Notion/` is read-only,
`Meetings/` notes never move (the meeting pass finds them by path), only `Inbox/` deletes, and
names are compared case-insensitively (Windows and macOS see one file).

Two more doors into the vault, both in this service:

- **The Brain Telegram bot** (`@drwade_brain_bot`, `telegram/`): anything Edward sends or
  forwards becomes an inbox note (`source: telegram`); voice notes are kept as audio in
  `Attachments/` and transcribed by Deepgram, with the glossary's **bold** names as keyterms;
  forwards arriving within 30 s of the last capture join its note. `/find`, `/inbox`, `/next`,
  `/todo`, `/today`. It answers only `TELEGRAM_ALLOWED_USER_ID`, in private.
- **To-dos** (`tasks/`): a message or voice note starting with « À faire », « To-do » or « Tâche »
  (or `/todo`) becomes lines in `Tasks.md` instead of a capture, in the Obsidian Tasks plugin's
  format (`- [ ] what 📅 2026-11-18`). The bot asks for when with day buttons, or takes a typed
  day (« jeudi », « 25/11 », `tasks/when.ts`) within 15 minutes. At `BRIEF_AT` (08:00) it sends
  the day's meetings, the to-dos due and late (from any note: a meeting action with a 📅 counts),
  and the inbox count; a ✓ button ticks one. Buttons are stateless: a tap reads the to-dos back
  from the message's own text, so they keep working across restarts.
- **Meeting prep** (`meetings/`): once a day (`MEETINGS_RUN_AT`), the published calendars
  (`CALENDAR_ICS_URL`: Outlook or Google ICS links, separated by spaces or commas) give the
  coming meetings, a meeting on two calendars counted once; each one gets
  `Meetings/<date> <time> <title>.md` as soon as it is within its rule's days
  (`Meetings/Rules.md`, a table Edward edits), with the previous meeting of the series and its
  open actions. The bot announces each note once, and the day before says how far the prep got.

Single user. Sign-in is GitHub only, and only for `ALLOWED_GITHUB_ID`
(Edward's numeric id, 38118787); unset, nobody gets in.

## How it fits together

- **GitHub is the vault's truth.** Captures, attachments and prep notes go
  through the contents API (create only, never overwrite: a taken name gets
  " (2)"). Every change to existing notes (edit, append, move, delete, a new
  note at a path) is computed from the branch head and committed on top of it
  through the Git Data API (`commitFiles`: tree, commit, then a
  non-forced ref update); if the branch moved meanwhile, it starts again from
  the new head, so a change made on the laptop is never overwritten. A move is
  one commit with the links it rewrites. Reads come from a tarball of the
  branch head, parsed once per commit and kept in memory; the head is
  re-checked at most every 15 s, before every change, and right after a
  capture; the connector's own commits update the snapshot without a new
  tarball (`vault/vault.service.ts`). No database row holds a note.
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

- **No worker for the webhook or the daily passes.** The handbook sends webhooks and batch jobs
  through BullMQ to a worker. Here Telegram is the queue: the webhook is registered with
  `max_connections: 1` and answers only once the note is saved, so a failure (GitHub down) is a
  500 and Telegram delivers the update again; after three tries the bot says it gave up. The
  meeting pass and the morning brief are timers in the API, made safe to repeat by
  `sent_reminders` (one row per pass, per brief and per reminder) and by notes being
  create-only. Reading an attachment (scaling a photo, a PDF's text) also happens in the request. One user, a few messages a day: a Redis and
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

- **GitHub's tarball splits long paths**: `git archive` writes ustar, where a path over 100
  bytes goes into the header's `prefix` and `name` fields, and a longer segment into a pax
  header. The root alone (`Dr-Wade-vault-<sha>/`) is 56 bytes, so most captures have long paths.
  `vault/tar.ts` reads all three forms; nanotar, used before, read only `name` and silently
  dropped those notes from search, read and the inbox. Its test builds tarballs with the real
  `git archive` (`github-tarball.fixture.ts`).
- **A message forwarded from a group carries its author, never the group**: Telegram does not
  tell bots where a forward came from, except for channel posts (which get a `t.me` link).
- **Outlook names its zones the Windows way** ("Romance Standard Time"): `calendar.ts`
  registers the feed's own VTIMEZONE blocks before reading any date. Outlook's published feed
  has titles, places and descriptions, but no attendees.
- **Outlook's published feed is slow and sometimes hangs** (100 s to the first byte seen, and
  hours of connection failures on 13 Nov 2026): the fetch has a 3-minute timeout, and a failed
  pass logs fetch's `cause` (the reason) and runs again at the next tick.
- **A tool result in Claude holds about 150,000 characters, a base64 image included**: a photo
  is scaled down (1568 px, then smaller) until its JPEG fits 110,000 characters. sharp needs its
  musl binary on Alpine; the Dockerfile's last check loads it.
- **Attachments are not in the tarball** (`export-ignore` in the vault's `.gitattributes`):
  `read_attachment` fetches the one file through the contents API (raw media type).
- **The calendar links and the bot token are secrets**: anyone holding the ICS link reads the
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
