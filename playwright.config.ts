import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

// The same root .env as development; CI sets the variables instead.
if (existsSync(".env")) {
    process.loadEnvFile(".env");
}

const apiPort = process.env.API_PORT || "4310";
const previewPort = process.env.PREVIEW_PORT || "4312";
const appUrl = `http://localhost:${previewPort}`;

// Journeys through the built client (`vite preview`, never the dev server)
// against the real API and database. Build first: `pnpm build`.
export default defineConfig({
    testDir: "e2e",
    fullyParallel: true,
    // Explicit: Playwright's default is half the cores, 1 on a 2-vCPU runner.
    workers: 4,
    // A retry hides a flaky test and doubles the cost of a real failure.
    retries: 0,
    forbidOnly: Boolean(process.env.CI),
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: appUrl,
        trace: "retain-on-failure"
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    webServer: [
        {
            command: "node services/api/dist/main.js",
            url: `http://localhost:${apiPort}/api/health`,
            // better-auth only trusts its own origin, which is the preview's here.
            env: { APP_URL: appUrl, NODE_ENV: "test" },
            reuseExistingServer: !process.env.CI
        },
        {
            command: "pnpm --filter @starter/client preview",
            url: appUrl,
            reuseExistingServer: !process.env.CI
        }
    ]
});
