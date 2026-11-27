#!/usr/bin/env bash
# Runs the checks this change needs side by side, and fails if any of them did.
set -euo pipefail
: "${RUNNER_TEMP:?}"

# Only a plain "false" skips a check: a missing answer runs it.
needed() { [ "${1:-}" != false ]; }

logs="$RUNNER_TEMP/checks"
mkdir -p "$logs"
behind=""
# Each on a core of its own while the suite runs; its words are kept and shown whole after.
start() {
  npm run "$1" > "$logs/${1/:/-}.log" 2>&1 &
  behind="$behind $1=$!"
}
start format:check
start knip
if needed "${CODE:-}"; then start lint; start typecheck:tests; fi
if needed "${APP:-}"; then start typecheck; fi

failed=0
npm run test || failed=1
for check in $behind; do
  name=${check%=*}
  if wait "${check#*=}"; then outcome=passed; else outcome=failed; failed=1; fi
  echo "::group::npm run $name: $outcome"
  cat "$logs/${name/:/-}.log"
  echo "::endgroup::"
  [ "$outcome" = passed ] || echo "::error::npm run $name failed."
done
exit "$failed"
