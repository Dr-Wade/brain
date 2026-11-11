import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { SentryGlobalFilter, SentryModule } from "@sentry/nestjs/setup";
import { loggerOptions } from "@brain/logger";
import { LoggerModule } from "nestjs-pino";

import { AuthModule } from "./auth/auth.module.js";
import { ClientConfigModule } from "./client-config/client-config.module.js";
import { ConfigModule } from "./config/app-config.js";
import { HealthModule } from "./health/health.module.js";
import { PrismaModule } from "./prisma/prisma.service.js";
import { RedisModule } from "./queues.module.js";
import { TodosModule } from "./todos/todos.module.js";

@Module({
    imports: [
        // Reports nothing unless instrument.ts initialised Sentry (SENTRY_DSN set).
        SentryModule.forRoot(),
        LoggerModule.forRoot({
            pinoHttp: {
                ...loggerOptions(),
                autoLogging: { ignore: req => req.url?.startsWith("/api/health") ?? false }
            }
        }),
        ConfigModule,
        PrismaModule,
        RedisModule,
        AuthModule,
        HealthModule,
        ClientConfigModule,
        TodosModule
    ],
    providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }]
})
export class AppModule {}
