import { createAuthClient } from "better-auth/vue";

// Same origin as the API (see vite.config.ts), so only the path is needed.
export const authClient = createAuthClient({ basePath: "/api/auth" });
