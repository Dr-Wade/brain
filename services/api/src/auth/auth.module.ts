import { mcp } from "@better-auth/mcp";
import { DEFAULT_OAUTH_SCOPES } from "@better-auth/oauth-provider";
import { Module } from "@nestjs/common";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins";
import { github } from "better-auth/social-providers";

import { AppConfig, type Env } from "../config/app-config.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Where Claude reaches the tools; the audience of every access token. */
export const mcpResource = (env: Pick<Env, "APP_URL">) => new URL("/api/mcp", env.APP_URL).href;

/**
 * True only for the one GitHub account allowed in. An unset allowlist lets
 * nobody in: this app holds one person's notes.
 */
export function isAllowedGithubAccount (profileId: unknown, allowedId: string | undefined): boolean {
    return allowedId !== undefined && (typeof profileId === "number" || typeof profileId === "string") && String(profileId) === allowedId;
}

export function createAuth (config: AppConfig, prisma: PrismaService) {
    const { env } = config;
    const githubOptions = { clientId: env.GITHUB_CLIENT_ID ?? "", clientSecret: env.GITHUB_CLIENT_SECRET ?? "" };
    const githubProvider = github(githubOptions);

    return betterAuth({
        database: prismaAdapter(prisma, { provider: "postgresql" }),
        baseURL: env.APP_URL,
        basePath: "/api/auth",
        // Unset outside production (AppConfig refuses to start without it
        // there): better-auth then uses its development key.
        secret: env.BETTER_AUTH_SECRET,
        trustedOrigins: [env.APP_URL],
        // Session JWTs must never pass as MCP access tokens.
        disabledPaths: ["/token"],
        socialProviders: {
            github: {
                ...githubOptions,
                // The default lookup, refused for any other account: the
                // callback then fails before a user is created.
                getUserInfo: async token => {
                    const info = await githubProvider.getUserInfo(token);
                    return isAllowedGithubAccount(info?.data?.id, env.ALLOWED_GITHUB_ID) ? info : null;
                }
            }
        },
        plugins: [
            jwt({ disableSettingJwtHeader: true }),
            // The OAuth 2.1 authorization server Claude's connector signs in
            // through, with the protected-resource metadata for /api/mcp.
            mcp({
                loginPage: "/sign-in",
                consentPage: "/consent",
                resource: mcpResource(env),
                // Declared in full: Prisma cannot store the null "any scope"
                // the plugin seeds otherwise (a PostgreSQL list is never null).
                resources: [{ identifier: mcpResource(env), name: "Vault", allowedScopes: [...DEFAULT_OAUTH_SCOPES] }],
                // Claude registers itself (RFC 7591) before the first sign-in.
                // Registering grants nothing: a token still needs this
                // account's sign-in and consent.
                allowDynamicClientRegistration: true,
                allowUnauthenticatedClientRegistration: true,
                clientRegistrationDefaultApplicationType: "infer"
            })
        ],
        // Rate limiting is on in production by default; tests make many calls.
        rateLimit: { enabled: env.NODE_ENV === "production" },
        telemetry: { enabled: false }
    });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * better-auth, mounted at /api/auth by @thallesp/nestjs-better-auth. The module
 * parses request bodies itself (main.ts creates the app with
 * `bodyParser: false`) and registers a global guard: every route needs a
 * session unless it is marked `@AllowAnonymous()`.
 */
@Module({
    imports: [
        BetterAuthModule.forRootAsync({
            inject: [AppConfig, PrismaService],
            useFactory: (config: AppConfig, prisma: PrismaService) => ({
                auth: createAuth(config, prisma),
                // Same origin in every environment (the dev server and the
                // reverse proxy both route /api), so no CORS at all.
                disableTrustedOriginsCors: true
            })
        })
    ]
})
export class AuthModule {}
