#!/usr/bin/env bash
# Makes the tag and the GitHub release, unless a run before this one already did.
set -euo pipefail
: "${GH_TOKEN:?}" "${TAG:?}" "${TITLE:?}"

if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
  echo "Release $TAG already exists."
  exit 0
fi
# Copilot's words go above GitHub's own list; without them the list stands alone.
notes=()
if [ -s "$RUNNER_TEMP/notes.md" ]; then notes=(--notes "$(cat "$RUNNER_TEMP/notes.md")"); fi
# Written so for an empty list: bash before 4.4 calls it unset.
gh release create "$TAG" --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" \
  --title "$TITLE" --generate-notes ${notes[@]+"${notes[@]}"}
