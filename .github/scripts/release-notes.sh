#!/usr/bin/env bash
# Has Copilot word the release from the commits since the last one, into $RUNNER_TEMP/notes.md.
set -euo pipefail
: "${GH_TOKEN:?}" "${RULES:?}" "${COPILOT_CLI:?}"

# Nothing to describe without a tag, and an existing release keeps the text it has.
[ -n "${TAG:-}" ] || exit 0
if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then exit 0; fi
previous=$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name 2>/dev/null) || previous=
subjects='"- " + (.commit.message | split("\n") | map(select(length > 0)) | join("\n  "))'
if [ -n "$previous" ]; then
  gh api "repos/$GITHUB_REPOSITORY/compare/$previous...$GITHUB_SHA" --jq \
    "\"Commits:\n\" + ([.commits[] | $subjects] | join(\"\n\")) + \"\n\nFiles changed:\n\" + ([.files[] | \"\(.status) \(.filename) (+\(.additions) -\(.deletions))\"] | join(\"\n\"))" \
    > "$RUNNER_TEMP/changes.txt"
else
  # A first release has nothing to compare with, so its last commits stand in.
  gh api "repos/$GITHUB_REPOSITORY/commits?sha=$GITHUB_SHA&per_page=20" --jq \
    "\"Commits:\n\" + ([.[] | $subjects] | join(\"\n\"))" > "$RUNNER_TEMP/changes.txt"
fi
# A commit released twice has nothing new to describe, and Copilot would say so in the release.
grep -q '^- ' "$RUNNER_TEMP/changes.txt" || exit 0
npm install --global --silent --no-audit --no-fund "@github/copilot@$COPILOT_CLI"
# An empty folder, as before the scripts were checked out: Copilot is handed its words, no files.
cd "$(mktemp -d)"
# No tools, so it can only word what it is handed; capped so a large release still fits one prompt.
copilot -p "$RULES"$'\n\n'"$(head -c 20000 "$RUNNER_TEMP/changes.txt")" -s --available-tools= > "$RUNNER_TEMP/draft.md"
[ -s "$RUNNER_TEMP/draft.md" ] || { echo "::warning::Copilot wrote nothing, so the release keeps GitHub's own notes."; exit 1; }
mv "$RUNNER_TEMP/draft.md" "$RUNNER_TEMP/notes.md"
cat "$RUNNER_TEMP/notes.md" >> "$GITHUB_STEP_SUMMARY"
