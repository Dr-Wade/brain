import { Global, Injectable, Module } from "@nestjs/common";
import { z } from "zod";

// Same conventions as the API's AppConfig: "" means unset, validated on first use.
const unsetIfEmpty = <T extends z.ZodType>(schema: T) => z.preprocess(v => (v === "" ? undefined : v), schema);
const optional = unsetIfEmpty(z.string().optional());

const EnvSchema = z.object({
    NODE_ENV: unsetIfEmpty(z.enum(["development", "test", "production"]).default("development")),
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),
    APP_URL: unsetIfEmpty(z.url().default("http://localhost:4311")),
    SMTP_HOST: optional,
    SMTP_PORT: unsetIfEmpty(z.coerce.number().int().positive().default(587)),
    SMTP_USER: optional,
    SMTP_PASS: optional,
    SMTP_FROM: unsetIfEmpty(z.string().default("noreply@example.invalid"))
});

export type Env = z.infer<typeof EnvSchema>;

@Injectable()
export class WorkerConfig {
    private parsed?: Env;

    constructor (private readonly source: NodeJS.ProcessEnv = process.env) {}

    get env (): Env {
        if (!this.parsed) {
            const result = EnvSchema.safeParse(this.source);
            if (!result.success) {
                throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
            }
            this.parsed = result.data;
        }
        return this.parsed;
    }
}

@Global()
@Module({
    providers: [{ provide: WorkerConfig, useFactory: () => new WorkerConfig() }],
    exports: [WorkerConfig]
})
export class ConfigModule {}
