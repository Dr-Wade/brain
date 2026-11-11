import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { SentryModule } from "@sentry/nestjs/setup";
import { loggerOptions } from "@starter/logger";
import { QUEUE_PREFIX, QUEUES } from "@starter/queues";
import type { Redis } from "ioredis";
import { LoggerModule } from "nestjs-pino";

import { ConfigModule } from "./config.js";
import { InfrastructureModule, REDIS } from "./infrastructure.js";
import { Mailer } from "./mailer.js";
import { TodoReminderProcessor } from "./reminders/todo-reminder.processor.js";

@Module({
    imports: [
        SentryModule.forRoot(),
        LoggerModule.forRoot({ pinoHttp: loggerOptions() }),
        ConfigModule,
        InfrastructureModule,
        BullModule.forRootAsync({
            inject: [REDIS],
            useFactory: (redis: Redis) => ({ connection: redis, prefix: QUEUE_PREFIX })
        }),
        BullModule.registerQueue({ name: QUEUES.todoReminders })
    ],
    providers: [Mailer, TodoReminderProcessor]
})
export class WorkerModule {}
