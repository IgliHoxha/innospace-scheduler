#!/usr/bin/env bash
# Runs one of these scripts as a user who cannot sudo, so the packages it runs cannot reach this job's secrets.
set -euo pipefail
: "${GITHUB_WORKSPACE:?}" "${HOME:?}"

SCRIPT="${1:?usage: sandbox.sh <script>.sh}"
ROOT="${SANDBOX_ROOT:-/srv/sandbox}"
[[ "$SCRIPT" =~ ^[a-z-]+\.sh$ ]] || { echo "::error::sandbox.sh takes the name of a script in its own folder." >&2; exit 2; }
# It adds a user and closes this home to others, which only a runner made for one job should have done to it.
[ "${GITHUB_ACTIONS:-}" = true ] || { echo "sandbox.sh runs on a GitHub runner only." >&2; exit 2; }
for name in ${SANDBOX_ENV:-}; do
  [[ "$name" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "::error::Not the name of a variable: $name" >&2; exit 2; }
done

# Nothing an earlier run left behind, running or written, meets this one.
sudo pkill -KILL -u sandbox 2> /dev/null || true
id -u sandbox > /dev/null 2>&1 || sudo useradd --system --user-group --no-create-home --home-dir "$ROOT/home" --shell /bin/bash sandbox
sudo rm -rf "$ROOT"
sudo mkdir -p "$ROOT/home" "$ROOT/tmp"
# This home is closed to it, and the checkout is made readable so the copy below is too.
chmod o-rwx "$HOME"
chmod -R o+rX "$GITHUB_WORKSPACE"
# A copy of its own, by hard links where the disk allows: it can add files, never rewrite one of the checkout's.
sudo cp -al "$GITHUB_WORKSPACE" "$ROOT/work" 2> /dev/null || { sudo rm -rf "$ROOT/work"; sudo cp -a "$GITHUB_WORKSPACE" "$ROOT/work"; }
# A hard link cannot be rewritten by another user, so the caches tools keep in node_modules stay behind.
if [ -d "$ROOT/work/node_modules" ]; then
  sudo find "$ROOT/work/node_modules" -mindepth 1 -maxdepth 1 -name '.*' ! -name .bin ! -name .package-lock.json -exec rm -rf {} +
fi
sudo find "$ROOT" -type d -exec chown sandbox: {} +

# What it is handed goes in a file only it can read, never on a command line, which every user can list.
for name in ${SANDBOX_ENV:-}; do
  printf 'export %s=%q\n' "$name" "${!name-}"
done | sudo install -m 600 -o sandbox -g sandbox /dev/stdin "$ROOT/home/.env"

status=0
# Started from an empty environment, so nothing of this step's own comes along unnamed.
sudo -u sandbox env -i "PATH=$PATH" "HOME=$ROOT/home" "TMPDIR=$ROOT/tmp" "RUNNER_TEMP=$ROOT/tmp" "GITHUB_WORKSPACE=$ROOT/work" CI=true GITHUB_ACTIONS=true \
  bash -c 'set -a; . "$HOME/.env"; set +a; rm -f "$HOME/.env"; cd "$GITHUB_WORKSPACE" && exec bash ".github/scripts/$1"' sandbox "$SCRIPT" || status=$?
# Whatever it left running ends with it, before a later step of this job starts.
sudo pkill -KILL -u sandbox 2> /dev/null || true
exit "$status"
