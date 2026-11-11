import { Global, Inject, Injectable, Module, type OnApplicationShutdown, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, prismaClientOptions } from "@brain/database";
import { createRedisClient } from "@brain/queues";
import type { Redis } from "ioredis";

import { WorkerConfig } from "./config.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
    constructor (@Inject(WorkerConfig) config: WorkerConfig) {
        super(prismaClientOptions(config.env.DATABASE_URL));
    }

    async onModuleDestroy () {
        await this.$disconnect();
    }
}

export const REDIS = Symbol("REDIS");

@Injectable()
class RedisCloser implements OnApplicationShutdown {
    constructor (@Inject(REDIS) private readonly redis: Redis) {}

    // Imported by WorkerModule only, so it shuts down after the BullMQ workers
    // (deeper modules first), which finish their active jobs on this client.
    async onApplicationShutdown () {
        await this.redis.quit();
    }
}

@Global()
@Module({
    providers: [
        PrismaService,
        { provide: REDIS, inject: [WorkerConfig], useFactory: (config: WorkerConfig) => createRedisClient(config.env.REDIS_URL) },
        RedisCloser
    ],
    exports: [PrismaService, REDIS]
})
export class InfrastructureModule {}
