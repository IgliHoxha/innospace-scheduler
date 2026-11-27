#!/usr/bin/env bash
# Has Copilot word the changes on its input into a draft on its output; run in the sandbox.
set -euo pipefail
: "${GH_TOKEN:?}" "${RULES:?}" "${COPILOT_CLI:?}" "${HOME:?}"

# Capped so a large release still fits one prompt.
changes=$(head -c 20000)
# Installed where this user may write, and its chatter kept off the draft.
export npm_config_prefix="$HOME/.npm-global"
export PATH="$npm_config_prefix/bin:$PATH"
npm install --global --silent --no-audit --no-fund "@github/copilot@$COPILOT_CLI" >&2
# An empty folder: Copilot is handed its words, no files.
cd "$(mktemp -d "${TMPDIR:-/tmp}/copilot.XXXXXX")"
# No tools, so it can only word what it is handed.
copilot -p "$RULES"$'\n\n'"$changes" -s --available-tools=
