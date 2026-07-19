#!/bin/sh
set -e

# The SQLite DB lives on a mounted volume (Docker named volume locally,
# Fly.io volume in prod). A freshly created Fly volume is owned by root, but the
# app runs as the unprivileged "node" user - so make the data dir writable, then
# drop privileges and exec the server as "node".
mkdir -p /app/data
chown -R node:node /app/data

exec su-exec node:node "$@"
