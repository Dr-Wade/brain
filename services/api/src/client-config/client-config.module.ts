import { Controller, Get, Inject, Module } from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { ClientConfig } from "@brain/schemas";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { mcpResource } from "../auth/auth.module.js";
import { AppConfig } from "../config/app-config.js";

/**
 * GET /api/config: the client's runtime configuration. The client image is the
 * same in every environment; whatever differs comes from here.
 */
@AllowAnonymous()
@Controller("config")
export class ClientConfigController {
    constructor (@Inject(AppConfig) private readonly config: AppConfig) {}

    @Get()
    @ApiOkResponse({ standardSchema: ClientConfig })
    get (): ClientConfig {
        const { env } = this.config;
        return {
            version: env.APP_VERSION,
            environment: env.NODE_ENV,
            sentryDsn: env.SENTRY_CLIENT_DSN ?? null,
            connectorUrl: mcpResource(env)
        };
    }
}

@Module({
    controllers: [ClientConfigController]
})
export class ClientConfigModule {}
