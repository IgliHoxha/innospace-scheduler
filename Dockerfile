# syntax=docker/dockerfile:1

# ---- Dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
# Build tools to compile the native better-sqlite3 module on musl/alpine.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
# The npm cache outlives this layer, so a lockfile change refetches only what moved.
RUN --mount=type=cache,target=/root/.npm npm ci

# ---- Build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Next keeps its compiler cache here, so a rebuild recompiles only what changed.
RUN --mount=type=cache,target=/app/.next/cache npm run build

# ---- Runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
# su-exec lets the entrypoint drop from root to "node" after fixing volume perms.
RUN apk add --no-cache su-exec
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=4001
ENV HOSTNAME=0.0.0.0
# SQLite DB file - mount a volume at /app/data to persist it.
ENV DATA_FILE=/app/data/scheduler.db

RUN mkdir -p /app/data && chown -R node:node /app

# Copy the standalone server output, static assets, and public files.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# The standalone trace carries the native sqlite binary: fail the build if it ever stops loading.
RUN node -e "new (require('better-sqlite3'))(':memory:').close()"
COPY --chown=node:node --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh

# Starts as root so the entrypoint can chown a freshly mounted volume, then it
# drops to the unprivileged "node" user before running the server.
VOLUME ["/app/data"]
EXPOSE 4001
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
