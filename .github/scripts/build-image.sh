#!/usr/bin/env bash
# Builds the image on Fly's builder and pushes it under this commit's label.
set -euo pipefail
: "${FLY_API_TOKEN:?}" "${IMAGE_LABEL:?}"

# Only a dropped builder connection is retried; a real build error fails at once.
for attempt in 1 2 3; do
  flyctl deploy --build-only --push --remote-only --image-label "$IMAGE_LABEL" --config fly.toml.example 2>&1 | tee build.log && exit 0
  grep -qE 'rpc error: code = Unavailable|error reading from server: EOF' build.log || exit 1
  echo "::warning::The builder dropped the connection (attempt $attempt of 3), retrying."
  sleep 20
done
exit 1
