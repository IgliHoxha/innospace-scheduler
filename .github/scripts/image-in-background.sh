#!/usr/bin/env bash
# Builds the image behind the checks: Fly's builder works while this runner's cores check.
set -euo pipefail
: "${RUNNER_TEMP:?}"

here=$(cd "$(dirname "$0")" && pwd)
log="$RUNNER_TEMP/image.log"
result="$RUNNER_TEMP/image.exit"
pid="$RUNNER_TEMP/image.pid"

case "${1:-}" in
  start)
    : "${FLY_API_TOKEN:?}" "${IMAGE_LABEL:?}"
    rm -f "$result"
    # Outlives this step. The exit code is moved into place, so "wait" never reads half of it.
    nohup bash -c 'bash "$0/build-image.sh"; echo $? > "$1.tmp"; mv "$1.tmp" "$1"' \
      "$here" "$result" > "$log" 2>&1 < /dev/null &
    echo $! > "$pid"
    echo "The image is building behind the checks; the last step of this job reads how it went."
    ;;
  wait)
    until [ -f "$result" ]; do
      # A build that died without a word must not hold the runner until the job's time limit.
      if ! kill -0 "$(cat "$pid")" 2> /dev/null && [ ! -f "$result" ]; then
        cat "$log"
        echo "::error::The image build stopped without a result: not released."
        exit 1
      fi
      sleep 1
    done
    cat "$log"
    exit "$(cat "$result")"
    ;;
  *)
    echo "usage: image-in-background.sh start|wait" >&2
    exit 2
    ;;
esac
