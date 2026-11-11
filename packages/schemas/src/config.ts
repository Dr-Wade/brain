import { z } from "zod";

// What the client reads from GET /api/config at start-up, so that one client
// image runs in every environment (no build-time configuration).
export const ClientConfig = z.object({
    version: z.string(),
    environment: z.string(),
    // Browser DSN. Null: Sentry stays off in the client.
    sentryDsn: z.string().nullable(),
    // The URL to add in Claude: built from APP_URL, the access tokens'
    // audience, so it matches even when the page is reached another way.
    connectorUrl: z.url()
}).meta({ id: "ClientConfig" });
export type ClientConfig = z.infer<typeof ClientConfig>;
