import { Controller, Get, Inject, Module, ServiceUnavailableException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { Redis } from "ioredis";

import { PrismaService } from "../prisma/prisma.service.js";
import { REDIS } from "../queues.module.js";

type Status = "up" | "down";

const probe = async (check: () => Promise<unknown>): Promise<Status> => {
    try {
        await check();
        return "up";
    } catch {
        return "down";
    }
};

@AllowAnonymous()
@ApiExcludeController()
@Controller("health")
export class HealthController {
    constructor (
        @Inject(PrismaService) private readonly prisma: PrismaService,
        @Inject(REDIS) private readonly redis: Redis
    ) {}

    /** Liveness: the process answers. No dependency is checked. */
    @Get()
    live () {
        return { status: "ok" };
    }

    /** Readiness: 503 while the database or Redis is unreachable. */
    @Get("ready")
    async ready () {
        const [database, redis] = await Promise.all([
            probe(() => this.prisma.$queryRaw`SELECT 1`),
            probe(() => this.redis.ping())
        ]);
        const body = { status: database === "up" && redis === "up" ? "ok" : "degraded", database, redis };
        if (body.status !== "ok") {
            throw new ServiceUnavailableException(body);
        }
        return body;
    }
}

@Module({
    controllers: [HealthController]
})
export class HealthModule {}
