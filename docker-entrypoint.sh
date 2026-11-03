#!/bin/sh
set -e

# A fresh Fly volume is root-owned, so hand it to "node" before running the server as it.
mkdir -p /app/data
chown -R node:node /app/data

exec su-exec node:node "$@"
