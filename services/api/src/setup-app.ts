import { StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { AuthService } from "@thallesp/nestjs-better-auth";
import { toNodeHandler } from "better-auth/node";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";
import type { Auth } from "./auth/auth.module.js";

/**
 * The application as main.ts serves it, without listening. The OpenAPI export
 * and the integration tests build it the same way, so what they see is what
 * production runs.
 */
export async function createApp () {
    // better-auth reads the raw request stream, so the auth module installs
    // the body parsers itself, keeping them off its own routes.
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, bufferLogs: true });
    app.useLogger(app.get(Logger));

    // Behind one reverse proxy: trust its X-Forwarded-* for client IPs and https.
    app.set("trust proxy", 1);

    // OAuth discovery lives at the root, outside /api (RFC 9728 and RFC 8414:
    // /.well-known/<kind><path>). better-auth's plugins answer it, so every
    // /.well-known request goes to better-auth, the bare forms rewritten to
    // the issuer's own. The reverse proxy routes /.well-known here too.
    const authHandler = toNodeHandler(app.get<AuthService<Auth>>(AuthService).instance);
    app.use((req: { url: string }, res: unknown, next: () => void) => {
        if (!req.url.startsWith("/.well-known/")) {
            next();
            return;
        }
        req.url = wellKnownUrl(req.url);
        void authHandler(req as Parameters<typeof authHandler>[0], res as Parameters<typeof authHandler>[1]);
    });
    app.setGlobalPrefix("api");
    // Validates every parameter declared with `{ schema }`; others pass through.
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    app.enableShutdownHooks();

    const document = createOpenApiDocument(app);
    SwaggerModule.setup("api/docs", app, document, { jsonDocumentUrl: "api/docs-json" });
    return { app, document };
}

/** The issuer is /api/auth; clients that ask the bare root get its metadata. */
export function wellKnownUrl (url: string): string {
    const at = url.indexOf("?");
    const path = at === -1 ? url : url.slice(0, at);
    const query = at === -1 ? "" : url.slice(at);
    const bare = path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration";
    return `${bare ? "/.well-known/oauth-authorization-server/api/auth" : path}${query}`;
}

function createOpenApiDocument (app: NestExpressApplication): OpenAPIObject {
    const config = new DocumentBuilder()
        .setTitle("Brain API")
        .setVersion(process.env.APP_VERSION ?? "dev")
        .addCookieAuth("better-auth.session_token")
        .build();
    return SwaggerModule.createDocument(app, config, {
        // `Health.live`…: the generated client nests by it.
        operationIdFactory: (controller, method) => `${controller.replace(/Controller$/, "")}.${method}`
    });
}
