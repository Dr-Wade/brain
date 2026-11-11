import { Body, Controller, Headers, HttpCode, Inject, Module, NotFoundException, Post } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";

import { AppConfig } from "../config/app-config.js";
import { VaultModule } from "../vault/vault.module.js";
import { VaultService } from "../vault/vault.service.js";
import type { TgUpdate } from "./bot-api.js";
import { TelegramService } from "./telegram.service.js";

/**
 * Telegram's webhook. The secret Telegram echoes in a header, not a session,
 * guards it; anything else is a 404, as if the route did not exist.
 */
@AllowAnonymous()
@ApiExcludeController()
@Controller("telegram")
export class TelegramController {
    constructor (@Inject(TelegramService) private readonly telegram: TelegramService) {}

    @Post("webhook")
    @HttpCode(200)
    async webhook (@Headers("x-telegram-bot-api-secret-token") secret: string | undefined, @Body() update: TgUpdate): Promise<{ ok: true }> {
        if (!this.telegram.acceptsSecret(secret)) {
            throw new NotFoundException();
        }
        await this.telegram.handle(update);
        return { ok: true };
    }
}

@Module({
    imports: [VaultModule],
    controllers: [TelegramController],
    // A factory: the service's last parameter is a test seam.
    providers: [{
        provide: TelegramService,
        useFactory: (config: AppConfig, vault: VaultService) => new TelegramService(config, vault),
        inject: [AppConfig, VaultService]
    }],
    exports: [TelegramService]
})
export class TelegramModule {}
