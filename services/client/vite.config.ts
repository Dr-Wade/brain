import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
    // Ports come from the root .env, like every other service's.
    const env = loadEnv(mode, root, "");
    // Same origin as in production, where the reverse proxy routes /api: the
    // client calls /api/... and never knows the API's address.
    const proxy = { "/api": { target: `http://localhost:${env.API_PORT || 4310}` } };
    return {
        plugins: [vue(), tailwindcss()],
        server: { port: Number(env.CLIENT_PORT || 4311), strictPort: true, proxy },
        preview: { port: Number(env.PREVIEW_PORT || 4312), strictPort: true, proxy }
    };
});
