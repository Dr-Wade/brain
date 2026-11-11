import "reflect-metadata";

import { createHash, randomBytes } from "node:crypto";
import { get } from "node:http";

import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp, wellKnownUrl } from "../setup-app.js";

/**
 * What Claude's connector does before it can call a tool, against the real
 * database through HTTP: discover the resource and its authorization server,
 * register, and start an authorization that lands on the sign-in page.
 */
describe.skipIf(!process.env.DATABASE_URL)("OAuth for the MCP endpoint", () => {
    let app: INestApplication;
    let root: string;
    const appUrl = process.env.APP_URL ?? "http://localhost:4691";
    const resource = `${appUrl}/api/mcp`;

    beforeAll(async () => {
        ({ app } = await createApp());
        await app.listen(0);
        root = (await app.getUrl()).replace("[::1]", "localhost");
    });

    afterAll(async () => {
        await app?.close();
    });

    it("challenges a call without a token, pointing at the resource metadata", async () => {
        const response = await fetch(`${root}/api/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${appUrl}/.well-known/oauth-protected-resource/api/mcp"`);
    });

    it("refuses a forged token", async () => {
        const response = await fetch(`${root}/api/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", "authorization": "Bearer not-a-jwt" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
        });
        expect(response.status).toBe(401);
    });

    it("serves the protected-resource and authorization-server metadata at the root", async () => {
        const protectedResource = await (await fetch(`${root}/.well-known/oauth-protected-resource/api/mcp`)).json() as Record<string, unknown>;
        expect(protectedResource).toMatchObject({ resource, authorization_servers: [`${appUrl}/api/auth`] });

        for (const path of ["/.well-known/oauth-authorization-server/api/auth", "/.well-known/oauth-authorization-server"]) {
            const metadata = await (await fetch(`${root}${path}`)).json() as Record<string, unknown>;
            expect(metadata).toMatchObject({
                issuer: `${appUrl}/api/auth`,
                authorization_endpoint: `${appUrl}/api/auth/oauth2/authorize`,
                token_endpoint: `${appUrl}/api/auth/oauth2/token`,
                registration_endpoint: `${appUrl}/api/auth/oauth2/register`
            });
            expect(metadata.code_challenge_methods_supported).toContain("S256");
        }
    });

    it("lets a client register, then sends the authorization to the sign-in page", async () => {
        const registered = await fetch(`${root}/api/auth/oauth2/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                client_name: "Claude",
                redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
                grant_types: ["authorization_code", "refresh_token"],
                response_types: ["code"],
                token_endpoint_auth_method: "none"
            })
        });
        expect(registered.status).toBe(201);
        const client = await registered.json() as { client_id: string; resources: string[] };
        expect(client.resources).toEqual([resource]);

        const verifier = randomBytes(32).toString("base64url");
        const query = new URLSearchParams({
            response_type: "code",
            client_id: client.client_id,
            redirect_uri: "https://claude.ai/api/mcp/auth_callback",
            scope: "openid profile email offline_access",
            state: "state",
            code_challenge: createHash("sha256").update(verifier).digest("base64url"),
            code_challenge_method: "S256",
            resource
        });
        // Plain HTTP like a browser navigation: Node's fetch always sends
        // sec-fetch-mode: cors, which gets the redirect as JSON instead.
        const authorize = await navigate(`${root}/api/auth/oauth2/authorize?${query}`);
        expect(authorize.status).toBe(302);
        const location = new URL(authorize.location!, appUrl);
        expect(location.pathname).toBe("/sign-in");
        expect(location.searchParams.get("client_id")).toBe(client.client_id);
        expect(location.searchParams.get("sig")).toBeTruthy();
    });

    it("keeps session JWTs away from the token endpoint they could be mistaken for", async () => {
        expect((await fetch(`${root}/api/auth/token`)).status).toBe(404);
    });
});

/** A GET that does not follow redirects, with no fetch-specific headers. */
function navigate (url: string): Promise<{ status: number; location?: string }> {
    return new Promise((resolve, reject) => {
        get(url, { headers: { accept: "text/html" } }, response => {
            response.resume();
            resolve({ status: response.statusCode ?? 0, location: response.headers.location });
        }).on("error", reject);
    });
}

describe("wellKnownUrl", () => {
    it("rewrites the bare discovery paths to the issuer's, keeping the query", () => {
        expect(wellKnownUrl("/.well-known/oauth-authorization-server")).toBe("/.well-known/oauth-authorization-server/api/auth");
        expect(wellKnownUrl("/.well-known/openid-configuration?x=1")).toBe("/.well-known/oauth-authorization-server/api/auth?x=1");
        expect(wellKnownUrl("/.well-known/oauth-protected-resource/api/mcp")).toBe("/.well-known/oauth-protected-resource/api/mcp");
    });
});
