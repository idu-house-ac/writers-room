#!/bin/sh
# Nightly Postgres backups with pg_dump (custom format, compressed).
#   sh backup.sh        run forever: back up on start (BACKUP_ON_START=1), then every day at BACKUP_TIME
#   sh backup.sh now    take one backup and exit
# Connection comes from the standard PG* environment variables (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_TIME=${BACKUP_TIME:-03:00}
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
BACKUP_ON_START=${BACKUP_ON_START:-1}
PREFIX=writers-room

mkdir -p "$BACKUP_DIR"

run_backup() {
  stamp=$(date +%Y%m%d-%H%M%S)
  file="$BACKUP_DIR/$PREFIX-$stamp.dump"
  if pg_dump --format=custom --compress=6 --file="$file.part"; then
    mv "$file.part" "$file"
    echo "$(date -u +%FT%TZ) backup written: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "$(date -u +%FT%TZ) backup FAILED" >&2
    return 1
  fi
  # Keep BACKUP_KEEP_DAYS days of dumps. This prunes database dumps only; script history inside the
  # database is never pruned.
  find "$BACKUP_DIR" -name "$PREFIX-*.dump" -type f -mtime +"$BACKUP_KEEP_DAYS" -print -delete | sed 's/^/pruned old backup: /'
}

seconds_until() {
  # $1 = HH:MM. Prints seconds from now until the next occurrence of that wall-clock time.
  th=${1%%:*}; tm=${1##*:}
  th=${th#0}; tm=${tm#0}
  nh=$(date +%H); nm=$(date +%M); ns=$(date +%S)
  nh=${nh#0}; nm=${nm#0}; ns=${ns#0}
  target=$(( ${th:-0} * 3600 + ${tm:-0} * 60 ))
  now=$(( ${nh:-0} * 3600 + ${nm:-0} * 60 + ${ns:-0} ))
  wait=$(( target - now ))
  [ "$wait" -le 0 ] && wait=$(( wait + 86400 ))
  echo "$wait"
}

if [ "${1:-}" = "now" ]; then
  run_backup
  exit $?
fi

if [ "$BACKUP_ON_START" = "1" ]; then
  run_backup || true
fi

while true; do
  wait=$(seconds_until "$BACKUP_TIME")
  echo "$(date -u +%FT%TZ) next backup at $BACKUP_TIME (in $wait s)"
  sleep "$wait"
  run_backup || true
  sleep 60
done
