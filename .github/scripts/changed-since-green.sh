#!/usr/bin/env bash
# Says which checks this change needs, measured from the last commit that passed them.
set -euo pipefail
: "${GITHUB_EVENT_NAME:?}" "${GITHUB_OUTPUT:?}"

# A pull request is measured from its base and main from its last green run; a manual run has neither.
BASE="${BASE:-}"
if [ "$GITHUB_EVENT_NAME" = push ]; then
  BASE=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/fly-deploy.yml/runs?branch=$GITHUB_REF_NAME&event=push&status=success&per_page=1" \
    --jq '.workflow_runs[0].head_sha // empty') || BASE=
fi
echo "Measured from ${BASE:-nothing, so every check runs}."
# A base git cannot find fails the diff too, so whatever is unsure gets checked.
changed() { if [ -n "$BASE" ] && git diff --quiet "$BASE" HEAD -- . "$@"; then echo false; else echo true; fi; }
{
  echo "any=$(changed ':!*.md' ':!docs')"
  echo "code=$(changed ':!*.md' ':!docs' ':!.github')"
  echo "app=$(changed ':!*.md' ':!docs' ':!.github' ':!tests' ':!vitest.config.mts')"
} | tee -a "$GITHUB_OUTPUT"
