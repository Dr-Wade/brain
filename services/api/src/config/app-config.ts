import { Global, Injectable, Module } from "@nestjs/common";
import { z } from "zod";

// An empty variable means "unset": compose files and orchestrators pass
// `${VAR:-}` through as "", and Zod applies `.default()` only to undefined.
const unsetIfEmpty = <T extends z.ZodType>(schema: T) => z.preprocess(v => (v === "" ? undefined : v), schema);
const optional = unsetIfEmpty(z.string().optional());

const EnvSchema = z.object({
    NODE_ENV: unsetIfEmpty(z.enum(["development", "test", "production"]).default("development")),
    APP_VERSION: unsetIfEmpty(z.string().default("dev")),
    API_PORT: unsetIfEmpty(z.coerce.number().int().positive().default(4690)),
    DATABASE_URL: z.url(),
    // Where users reach the app. The client is served there and /api is routed
    // beside it, so this is better-auth's base URL and its only trusted origin.
    APP_URL: unsetIfEmpty(z.url().default("http://localhost:4691")),
    BETTER_AUTH_SECRET: optional,
    // Sign-in is GitHub only, and only for the one account named here (its
    // numeric id, which never changes). Unset: nobody can sign in.
    GITHUB_CLIENT_ID: optional,
    GITHUB_CLIENT_SECRET: optional,
    ALLOWED_GITHUB_ID: unsetIfEmpty(z.string().regex(/^\d+$/, "a numeric GitHub user id").optional()),
    // The vault: an Obsidian vault in a GitHub repo, written through the
    // contents API. The token needs Contents read and write on that repo only.
    VAULT_REPO: unsetIfEmpty(z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/name").optional()),
    VAULT_BRANCH: unsetIfEmpty(z.string().default("main")),
    VAULT_TOKEN: optional,
    // Inbox file names and capture times are in this zone.
    VAULT_TIMEZONE: unsetIfEmpty(z.string().default("Europe/Paris")),
    // Repos the file_for_atlas tool may open issues on (comma-separated
    // owner/name), and a token with Issues read and write on them.
    ISSUE_REPOS: unsetIfEmpty(z.string().optional()),
    ISSUE_TOKEN: optional,
    SENTRY_DSN: optional,
    SENTRY_CLIENT_DSN: optional
}).superRefine((env, ctx) => {
    // Without a secret better-auth signs sessions with a well-known development
    // key, so anyone could forge one. Refuse to start instead.
    if (env.NODE_ENV === "production" && (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)) {
        ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "required in production, at least 32 characters" });
    }
});

/** The repos named in ISSUE_REPOS, trimmed, without empties. */
export function issueRepos (env: Pick<Env, "ISSUE_REPOS">): string[] {
    return (env.ISSUE_REPOS ?? "").split(",").map(repo => repo.trim()).filter(Boolean);
}

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv (source: NodeJS.ProcessEnv): Env {
    const result = EnvSchema.safeParse(source);
    if (!result.success) {
        throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
    }
    return result.data;
}

/**
 * The environment, validated on first use rather than at import or module
 * registration: a test can build any module with `new AppConfig({ ... })`
 * and no environment at all.
 */
@Injectable()
export class AppConfig {
    private parsed?: Env;

    constructor (private readonly source: NodeJS.ProcessEnv = process.env) {}

    get env (): Env {
        this.parsed ??= parseEnv(this.source);
        return this.parsed;
    }
}

@Global()
@Module({
    providers: [{ provide: AppConfig, useFactory: () => new AppConfig() }],
    exports: [AppConfig]
})
export class ConfigModule {}
