import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "prisma/config";

// Development reads the root .env; CI and production set DATABASE_URL.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
    process.loadEnvFile(rootEnv);
}

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: { path: "prisma/migrations" },
    // Not env("DATABASE_URL"), which throws when it is unset: `prisma generate`
    // (the build, the Docker image) needs no database. A command that connects
    // without one fails with Prisma's own error.
    datasource: { url: process.env.DATABASE_URL ?? "" }
});
