import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { requireMcpAuth } from "@better-auth/mcp";
import { All, Controller, Inject, Injectable, Module, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { AllowAnonymous, AuthService } from "@thallesp/nestjs-better-auth";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

import { mcpResource, type Auth } from "../auth/auth.module.js";
import { AppConfig, issueRepos } from "../config/app-config.js";
import { MeetingsModule } from "../meetings/meetings.module.js";
import { MeetingsService } from "../meetings/meetings.service.js";
import { VaultModule } from "../vault/vault.module.js";
import { VaultService } from "../vault/vault.service.js";
import { createVaultMcpServer } from "./tools.js";

/**
 * The MCP endpoint as a fetch handler: the OAuth access token is checked
 * (signature, issuer, audience = /api/mcp, expiry) before a request reaches
 * the tools. Stateless: a fresh server per request.
 */
@Injectable()
export class McpEndpoint {
    private handler?: (request: Request) => Promise<Response>;

    constructor (
        @Inject(AppConfig) private readonly config: AppConfig,
        @Inject(AuthService) private readonly auth: AuthService<Auth>,
        @Inject(VaultService) private readonly vault: VaultService,
        @Inject(MeetingsService) private readonly meetings: MeetingsService
    ) {}

    handle (request: Request): Promise<Response> {
        this.handler ??= this.build();
        return this.handler(request);
    }

    private build () {
        const { env } = this.config;
        const options = {
            issueRepos: env.ISSUE_TOKEN ? issueRepos(env) : [],
            version: env.APP_VERSION,
            meetings: this.meetings.configured ? this.meetings : undefined
        };
        const mcp = createMcpHandler(() => createVaultMcpServer(this.vault, options));
        return requireMcpAuth(this.auth.instance, request => mcp.fetch(request), { resource: mcpResource(env) });
    }
}

@AllowAnonymous()
@ApiExcludeController()
@Controller("mcp")
export class McpController {
    constructor (
        @Inject(McpEndpoint) private readonly endpoint: McpEndpoint,
        @Inject(AppConfig) private readonly config: AppConfig
    ) {}

    // The bearer token, not a session cookie, guards this route (McpEndpoint).
    @All()
    async handle (@Req() req: ExpressRequest, @Res() res: ExpressResponse): Promise<void> {
        const response = await this.endpoint.handle(toFetchRequest(req, this.config.env.APP_URL));
        res.status(response.status);
        response.headers.forEach((value, name) => res.setHeader(name, value));
        if (!response.body) {
            res.end();
            return;
        }
        Readable.fromWeb(response.body as NodeReadableStream).pipe(res);
    }
}

/**
 * The Express request as a fetch Request on the public URL (the token's
 * audience is checked against it). Express has already parsed a JSON body.
 */
export function toFetchRequest (req: ExpressRequest, appUrl: string): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (value === undefined) {
            continue;
        }
        for (const one of Array.isArray(value) ? value : [value]) {
            headers.append(name, one);
        }
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let body: string | undefined;
    if (hasBody) {
        body = typeof req.body === "string" ? req.body : req.body === undefined ? undefined : JSON.stringify(req.body);
        // The length Express read no longer matches a re-serialised body.
        headers.delete("content-length");
    }
    return new Request(new URL(req.originalUrl, appUrl), { method: req.method, headers, body });
}

@Module({
    imports: [VaultModule, MeetingsModule],
    controllers: [McpController],
    providers: [McpEndpoint]
})
export class McpModule {}
