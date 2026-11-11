import { Controller, Get, Inject, Module, ServiceUnavailableException } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { PrismaService } from "../prisma/prisma.service.js";

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
        @Inject(PrismaService) private readonly prisma: PrismaService
    ) {}

    /** Liveness: the process answers. No dependency is checked. */
    @Get()
    live () {
        return { status: "ok" };
    }

    /** Readiness: 503 while the database is unreachable. */
    @Get("ready")
    async ready () {
        const database = await probe(() => this.prisma.$queryRaw`SELECT 1`);
        const body = { status: database === "up" ? "ok" : "degraded", database };
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
