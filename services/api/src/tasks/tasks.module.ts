import { Module } from "@nestjs/common";

import { AppConfig } from "../config/app-config.js";
import { MeetingsModule, prismaReminderLog } from "../meetings/meetings.module.js";
import { MeetingsService } from "../meetings/meetings.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { TelegramService } from "../telegram/telegram.service.js";
import { VaultModule } from "../vault/vault.module.js";
import { VaultService } from "../vault/vault.service.js";
import { TasksService } from "./tasks.service.js";

@Module({
    imports: [VaultModule, TelegramModule, MeetingsModule],
    providers: [{
        provide: TasksService,
        useFactory: (config: AppConfig, vault: VaultService, telegram: TelegramService, meetings: MeetingsService, prisma: PrismaService) =>
            new TasksService(config, vault, telegram, meetings, prismaReminderLog(prisma)),
        inject: [AppConfig, VaultService, TelegramService, MeetingsService, PrismaService]
    }],
    exports: [TasksService]
})
export class TasksModule {}
