import { BullModule } from "@nestjs/bullmq";
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createRedisClient, QUEUE_PREFIX, QUEUES } from "@starter/queues";
import type { Redis } from "ioredis";

import { AppConfig } from "./config/app-config.js";

export const REDIS = Symbol("REDIS");

@Injectable()
class RedisCloser implements OnApplicationShutdown {
    constructor (@Inject(REDIS) private readonly redis: Redis) {}

    // Nest runs shutdown hooks from the most deeply imported module outwards.
    // This module is imported by AppModule only, so BullMQ's queues have
    // closed by the time the client they share is.
    async onApplicationShutdown () {
        await this.redis.quit();
    }
}

/** The process's one Redis client. Imported by AppModule only (see RedisCloser). */
@Global()
@Module({
    providers: [
        { provide: REDIS, inject: [AppConfig], useFactory: (config: AppConfig) => createRedisClient(config.env.REDIS_URL) },
        RedisCloser
    ],
    exports: [REDIS]
})
export class RedisModule {}

/** The queues the API enqueues to. The worker processes them (services/worker). */
@Module({
    imports: [
        BullModule.forRootAsync({
            inject: [REDIS],
            useFactory: (redis: Redis) => ({ connection: redis, prefix: QUEUE_PREFIX })
        }),
        BullModule.registerQueue({ name: QUEUES.todoReminders })
    ],
    exports: [BullModule]
})
export class QueuesModule {}
