import { z } from "zod";

// What the client reads from GET /api/config at start-up, so that one client
// image runs in every environment (no build-time configuration).
export const ClientConfig = z.object({
    version: z.string(),
    environment: z.string(),
    // Browser DSN. Null: Sentry stays off in the client.
    sentryDsn: z.string().nullable()
}).meta({ id: "ClientConfig" });
export type ClientConfig = z.infer<typeof ClientConfig>;
