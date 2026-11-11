# syntax=docker/dockerfile:1.7
# One Dockerfile, one target per service: docker build --target api|worker|client .

ARG NODE_IMAGE=node:26-alpine

# ─── build: install everything, compile everything ──────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json ./
# pnpm at the version package.json pins (Node 26 ships without corepack).
RUN npm install -g "$(node -p "require('./package.json').packageManager")"

COPY pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/database/package.json packages/database/
COPY packages/logger/package.json packages/logger/
COPY packages/queues/package.json packages/queues/
COPY packages/schemas/package.json packages/schemas/
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
COPY services/client/package.json services/client/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY scripts scripts
COPY packages packages
COPY services services
RUN pnpm -r build

# Production dependencies only, with the workspace packages copied in as real
# directories (injectWorkspacePackages), so nothing points back into /app.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter @starter/api --prod /out/api && \
    pnpm deploy --filter @starter/worker --prod /out/worker

# ─── api ────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS api
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION} API_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
# Checked in the final image: a workspace package that did not make it into
# the pruned tree fails the build here, not at the first request.
RUN node --input-type=module -e "await import('@starter/database'); await import('@starter/schemas'); await import('@starter/queues'); await import('@starter/logger')"
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
    CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
# Migrations first: written so the previous release still runs on the new
# schema (see the handbook's deploy.md, Rolling back).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --config node_modules/@starter/database/prisma.config.ts && exec node dist/main.js"]

# ─── worker ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS worker
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build --chown=node:node /out/worker ./
RUN node --input-type=module -e "await import('@starter/database'); await import('@starter/queues'); await import('@starter/logger')"
USER node
CMD ["node", "dist/main.js"]

# ─── client: static files only; the reverse proxy routes /api to the API ────
FROM nginx:1-alpine AS client
COPY services/client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/services/client/dist /usr/share/nginx/html
EXPOSE 80
