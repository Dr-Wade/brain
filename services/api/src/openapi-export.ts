import "reflect-metadata";

import { writeFile } from "node:fs/promises";

import { createApp } from "./setup-app.js";

// Writes services/api/openapi.json, which services/client generates its SDK
// from (`pnpm openapi` at the root runs both). Committed, so the client builds
// without a running API and a stale spec shows up as a diff in CI.
const { app, document } = await createApp();
await writeFile(new URL("../openapi.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
await app.close();
