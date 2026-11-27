#!/usr/bin/env bash
# Purges the booking page from Cloudflare's edge, which would go on serving the old build.
set -euo pipefail

if [ -z "${CF_ZONE_ID:-}" ] || [ -z "${CF_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN not set, skipping purge."
  exit 0
fi
# One URL, not the zone: innospacetirana.com is shared with the marketing site.
curl --fail-with-body -sS -X POST \
  "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://scheduler.innospacetirana.com/"]}'
