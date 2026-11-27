#!/usr/bin/env bash
# Runs the checks this change needs: the static ones on one core, the suite on the others.
set -euo pipefail
: "${RUNNER_TEMP:?}"

# Only a plain "false" skips a check: a missing answer runs it.
needed() { [ "${1:-}" != false ]; }

logs="$RUNNER_TEMP/checks"
mkdir -p "$logs"
static="format:check knip"
if needed "${CODE:-}"; then static="$static lint typecheck:tests"; fi
if needed "${APP:-}"; then static="$static typecheck"; fi

# One after another: all at once they took the cores from the suite's slowest file and saved nothing.
(
  for name in $static; do
    if npm run "$name" > "$logs/${name/:/-}.log" 2>&1; then echo passed; else echo failed; fi > "$logs/${name/:/-}.result"
  done
) &
chain=$!

cores=$(nproc 2> /dev/null || getconf _NPROCESSORS_ONLN)
failed=0
# The suite leaves that one core alone where there are cores to spare.
npm run test -- --maxWorkers="$((cores > 2 ? cores - 1 : cores))" || failed=1
wait "$chain" || true
for name in $static; do
  outcome=$(cat "$logs/${name/:/-}.result" 2> /dev/null || echo failed)
  [ "$outcome" = passed ] || failed=1
  echo "::group::npm run $name: $outcome"
  cat "$logs/${name/:/-}.log"
  echo "::endgroup::"
  [ "$outcome" = passed ] || echo "::error::npm run $name failed."
done
exit "$failed"
