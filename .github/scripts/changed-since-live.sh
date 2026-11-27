#!/usr/bin/env bash
# Says what this push changes of what is live: whether to release, and whether to back up first.
set -euo pipefail
: "${FLY_API_TOKEN:?}" "${GITHUB_EVENT_NAME:?}" "${GITHUB_OUTPUT:?}"

# What opens or lays out the volume: the one SQL module, the image's boot and the mount.
TOUCHES="src/lib/db.ts Dockerfile docker-entrypoint.sh fly.toml.example"

# The live image's tag names its commit; when Fly cannot say, everything counts as changed.
live=$(flyctl image show --config fly.toml.example --json | jq -r '.[0].Tag // empty' | sed -n 's/^sha-//p') || live=
# Compared with what is live, so a failed or superseded run is never skipped over.
if [ "$GITHUB_EVENT_NAME" = push ] && [ -n "$live" ] &&
  git diff --quiet "$live" HEAD -- . ':!tests' ':!docs' ':!.github' ':!*.md' ':!vitest.config.mts' \
    ':!Makefile' ':!docker-compose.yml' ':!.env*' ':!.gitignore' ':!.prettierrc.json' ':!.prettierignore' \
    ':!knip.json' ':!.gitguardian.yaml' ':!LICENSE' ':!NOTICE'; then
  echo "::notice::Nothing in the image changed since $live, so there is nothing to release."
  echo "release=false" >> "$GITHUB_OUTPUT"
else
  echo "release=true" >> "$GITHUB_OUTPUT"
fi
# A manual run or an image no commit names takes the backup anyway.
# shellcheck disable=SC2086
if [ "$GITHUB_EVENT_NAME" = push ] && [ -n "$live" ] && git diff --quiet "$live" HEAD -- $TOUCHES; then
  echo "backup=false" >> "$GITHUB_OUTPUT"
else
  echo "backup=true" >> "$GITHUB_OUTPUT"
fi
