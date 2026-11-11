import { defineConfig } from "@hey-api/openapi-ts";

// Generates src/api/ from the API's committed OpenAPI document. Run
// `pnpm openapi` at the root after changing an endpoint: it exports the
// document and regenerates this.
export default defineConfig({
    input: "../api/openapi.json",
    output: "src/api",
    plugins: [
        "@hey-api/typescript",
        // healthLive()…: named from the operationId (`Health.live`).
        { name: "@hey-api/sdk", operations: { nesting: "operationId" } },
        "@hey-api/client-fetch",
        // Query and mutation options for TanStack Query: clientConfigGetOptions()…
        "@tanstack/vue-query"
    ]
});
