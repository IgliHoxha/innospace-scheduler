#!/usr/bin/env bash
# Asks couch-gag for this commit's episode and hands on the release's tag and title.
set -euo pipefail
: "${COUCH_GAG_URL:?}" "${COUCH_GAG_KEY:?}" "${GITHUB_OUTPUT:?}"

# couch-gag gives the same episode for the same commit, so a re-run uses no new one.
body=$(jq -n --arg repo "$GITHUB_REPOSITORY" --arg ref "$GITHUB_SHA" '{repo: $repo, ref: $ref}')
release=$(curl --fail-with-body -sS --retry 4 --retry-all-errors --max-time 20 \
  -H "Authorization: Bearer $COUCH_GAG_KEY" -H "Content-Type: application/json" \
  -d "$body" "$COUCH_GAG_URL/v1/releases")
tag=$(jq -r '"r\(.sequence)-\(.slug)"' <<<"$release")
if ! [[ "$tag" =~ ^r[0-9]+-[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "::error::couch-gag answered something that is not a release: $release"; exit 1
fi
echo "tag=$tag" >> "$GITHUB_OUTPUT"
echo "title=$(jq -r '.name' <<<"$release")" >> "$GITHUB_OUTPUT"
