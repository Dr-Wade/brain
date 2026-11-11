import { Module } from "@nestjs/common";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../prisma/prisma.service.js";

export function createAuth (config: AppConfig, prisma: PrismaService) {
    const { env } = config;
    return betterAuth({
        database: prismaAdapter(prisma, { provider: "postgresql" }),
        baseURL: env.APP_URL,
        basePath: "/api/auth",
        // Unset outside production (AppConfig refuses to start without it
        // there): better-auth then uses its development key.
        secret: env.BETTER_AUTH_SECRET,
        trustedOrigins: [env.APP_URL],
        emailAndPassword: { enabled: true, minPasswordLength: 10 },
        // Rate limiting is on in production by default; tests sign up many users.
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
