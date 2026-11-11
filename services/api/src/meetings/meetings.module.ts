import { Module } from "@nestjs/common";

import { AppConfig } from "../config/app-config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { TelegramModule } from "../telegram/telegram.module.js";
import { TelegramService } from "../telegram/telegram.service.js";
import { VaultModule } from "../vault/vault.module.js";
import { VaultService } from "../vault/vault.service.js";
import { MeetingsService, type ReminderLog } from "./meetings.service.js";

/** The reminder log in Postgres: a key's row is its claim. */
export function prismaReminderLog (prisma: PrismaService): ReminderLog {
    return {
        async claim (key) {
            const { count } = await prisma.sentReminder.createMany({ data: [{ key }], skipDuplicates: true });
            return count === 1;
        },
        async release (key) {
            await prisma.sentReminder.deleteMany({ where: { key } });
        }
    };
}

@Module({
    imports: [VaultModule, TelegramModule],
    providers: [{
        provide: MeetingsService,
        useFactory: (config: AppConfig, vault: VaultService, telegram: TelegramService, prisma: PrismaService) =>
            new MeetingsService(config, vault, telegram, prismaReminderLog(prisma)),
        inject: [AppConfig, VaultService, TelegramService, PrismaService]
    }],
    exports: [MeetingsService]
})
export class MeetingsModule {}
