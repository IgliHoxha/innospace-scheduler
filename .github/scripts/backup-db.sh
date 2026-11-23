#!/usr/bin/env bash
# Copies the live database out of the Fly machine, checks it opens, and stores it gzipped in the R2 bucket.
set -euo pipefail

APP="${APP:-innospace-scheduler}"
BUCKET="${BUCKET:-innospace-scheduler-backups}"
# "nightly" or "pre-release-<commit>": part of the object's name, so a restore point is easy to find.
LABEL="${1:?usage: backup-db.sh <label>}"
: "${FLY_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# ssh reaches only a running machine, and a suspended one does not wake for it.
machine=$(flyctl machine list -a "$APP" --json | jq -er 'if length == 1 then .[0].id else error("expected one machine, found \(length)") end')
flyctl machine start "$machine" -a "$APP" > /dev/null

# VACUUM INTO writes one consistent file, journal included, while the app keeps serving.
read -r -d '' copy <<'EOF' || true
sh -c "rm -f /tmp/scheduler-backup.db /tmp/scheduler-backup.db.gz && node -e \"require(\\\"/app/node_modules/better-sqlite3\\\")(\\\"/app/data/scheduler.db\\\",{readonly:true,fileMustExist:true}).prepare(\\\"VACUUM INTO ?\\\").run(\\\"/tmp/scheduler-backup.db\\\")\" && gzip -9 /tmp/scheduler-backup.db"
EOF
flyctl ssh console -a "$APP" -C "$copy" > /dev/null
flyctl ssh sftp get /tmp/scheduler-backup.db.gz "$work/backup.db.gz" -a "$APP" > /dev/null
flyctl ssh console -a "$APP" -C "rm -f /tmp/scheduler-backup.db.gz" > /dev/null

# A copy that does not open is not a backup, so it is checked before it is kept.
gunzip -c "$work/backup.db.gz" > "$work/backup.db"
check=$(sqlite3 "$work/backup.db" "PRAGMA integrity_check")
[ "$check" = ok ] || { echo "::error::The copy fails SQLite's integrity check: $check"; exit 1; }
rows=$(sqlite3 "$work/backup.db" "SELECT count(*) FROM reservations")

# Only counts and sizes are printed: the repository is public and the file holds bookers' emails.
key="scheduler-$(date -u +%Y-%m-%dT%H%MZ)-$LABEL.db.gz"
# R2's S3 interface is the one that takes keys limited to this bucket; they go in a file, never on a command line.
(umask 077 && printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" > "$work/r2.curl")
curl --fail-with-body -sS --retry 3 --max-time 60 -o /dev/null -K "$work/r2.curl" --aws-sigv4 "aws:amz:auto:s3" \
  -T "$work/backup.db.gz" -H "x-amz-content-sha256: $(shasum -a 256 "$work/backup.db.gz" | cut -d' ' -f1)" \
  -H "Content-Type: application/gzip" "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com/$BUCKET/$key"
echo "Restore point: \`$key\` in the R2 bucket \`$BUCKET\` ($rows reservations, $(wc -c < "$work/backup.db.gz" | tr -d ' ') bytes)." >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
