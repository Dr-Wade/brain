import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/vue";

// Same origin as the API (see vite.config.ts), so only the path is needed.
// The OAuth provider plugin carries Claude's signed authorization request
// through sign-in and consent (it adds it to every POST from those pages).
export const authClient = createAuthClient({ basePath: "/api/auth", plugins: [oauthProviderClient()] });

/** True on a page reached from an OAuth authorize redirect (its query is signed). */
export const isOAuthRequest = (query: Record<string, unknown>) => typeof query.sig === "string";
