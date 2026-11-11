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
    REDIS_URL: z.url(),
    // Where users reach the app. The client is served there and /api is routed
    // beside it, so this is better-auth's base URL and its only trusted origin.
    APP_URL: unsetIfEmpty(z.url().default("http://localhost:4691")),
    BETTER_AUTH_SECRET: optional,
    SENTRY_DSN: optional,
    SENTRY_CLIENT_DSN: optional
}).superRefine((env, ctx) => {
    // Without a secret better-auth signs sessions with a well-known development
    // key, so anyone could forge one. Refuse to start instead.
    if (env.NODE_ENV === "production" && (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32)) {
        ctx.addIssue({ code: "custom", path: ["BETTER_AUTH_SECRET"], message: "required in production, at least 32 characters" });
    }
});

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
