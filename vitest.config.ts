import { existsSync } from "node:fs";

import { defineConfig } from "vitest/config";

// Tests read the same root .env as development (CI sets the variables instead).
if (existsSync(".env")) {
    process.loadEnvFile(".env");
}
process.env.NODE_ENV = "test";

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "node",
                    environment: "node",
                    include: ["packages/*/src/**/*.spec.ts", "services/api/src/**/*.spec.ts"]
                }
            },
            {
                // The client's own Vite config: its plugins, its resolution.
                extends: "./services/client/vite.config.ts",
                test: {
                    name: "client",
                    environment: "happy-dom",
                    include: ["services/client/src/**/*.spec.ts"]
                }
            }
        ],
        coverage: {
            provider: "v8",
            include: ["packages/*/src/**", "services/*/src/**"],
            // Wiring is not measured (see the handbook's ci.md, Coverage).
            exclude: [
                "**/*.spec.ts",
                "**/src/generated/**",
                "**/src/api/**",
                "**/main.ts",
                "**/instrument.ts",
                "**/setup-app.ts",
                "**/openapi-export.ts",
                "**/*.module.ts"
            ],
            // Fails the full suite (never the PR check) below these. Set just
            // under the template's own numbers; raise them as the project grows.
            thresholds: { lines: 45, statements: 45, functions: 35, branches: 30 }
        }
    }
});
