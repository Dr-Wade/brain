import { StandardSchemaValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";

import { AppModule } from "./app.module.js";

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
    app.setGlobalPrefix("api");
    // Validates every parameter declared with `{ schema }`; others pass through.
    app.useGlobalPipes(new StandardSchemaValidationPipe());
    app.enableShutdownHooks();

    const document = createOpenApiDocument(app);
    SwaggerModule.setup("api/docs", app, document, { jsonDocumentUrl: "api/docs-json" });
    return { app, document };
}

function createOpenApiDocument (app: NestExpressApplication): OpenAPIObject {
    const config = new DocumentBuilder()
        .setTitle("Starter API")
        .setVersion(process.env.APP_VERSION ?? "dev")
        .addCookieAuth("better-auth.session_token")
        .build();
    return SwaggerModule.createDocument(app, config, {
        // `Todos.list`, `Todos.create`…: the generated client nests by it.
        operationIdFactory: (controller, method) => `${controller.replace(/Controller$/, "")}.${method}`
    });
}
