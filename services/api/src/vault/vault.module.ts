import { Module } from "@nestjs/common";

import { AppConfig } from "../config/app-config.js";
import { VaultService } from "./vault.service.js";

@Module({
    // A factory: the service's other constructor parameters (fetch, clock)
    // are for tests, not for the container.
    providers: [{ provide: VaultService, useFactory: (config: AppConfig) => new VaultService(config), inject: [AppConfig] }],
    exports: [VaultService]
})
export class VaultModule {}
