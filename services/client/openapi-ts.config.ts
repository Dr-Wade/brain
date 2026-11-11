import { defineConfig } from "@hey-api/openapi-ts";

// Generates src/api/ from the API's committed OpenAPI document. Run
// `pnpm openapi` at the root after changing an endpoint: it exports the
// document and regenerates this.
export default defineConfig({
    input: "../api/openapi.json",
    output: "src/api",
    plugins: [
        "@hey-api/typescript",
        // todosList(), todosCreate()…: named from the operationId (`Todos.list`).
        { name: "@hey-api/sdk", operations: { nesting: "operationId" } },
        "@hey-api/client-fetch",
        // Query and mutation options for TanStack Query: todosListOptions()…
        "@tanstack/vue-query"
    ]
});
