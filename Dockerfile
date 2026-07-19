# syntax=docker/dockerfile:1

# ---- Dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
# Build tools to compile the native better-sqlite3 module on musl/alpine.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# ---- Build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

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
# Ensure the native sqlite module (with its compiled .node binary) is present.
COPY --from=builder --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=builder --chown=node:node /app/node_modules/bindings ./node_modules/bindings
COPY --from=builder --chown=node:node /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path
COPY --chown=node:node docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Starts as root so the entrypoint can chown a freshly mounted volume, then it
# drops to the unprivileged "node" user before running the server.
VOLUME ["/app/data"]
EXPOSE 4001
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
