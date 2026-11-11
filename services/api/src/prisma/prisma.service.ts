import { Global, Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { PrismaClient, prismaClientOptions } from "@brain/database";

import { AppConfig } from "../config/app-config.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
    constructor (@Inject(AppConfig) config: AppConfig) {
        super(prismaClientOptions(config.env.DATABASE_URL));
    }

    async onModuleDestroy () {
        await this.$disconnect();
    }
}

@Global()
@Module({
    providers: [PrismaService],
    exports: [PrismaService]
})
export class PrismaModule {}
