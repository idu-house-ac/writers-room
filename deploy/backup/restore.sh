#!/bin/sh
# Restore a dump into a database. Creates the database if it does not exist.
#   sh restore.sh /backups/writers-room-20261118-030000.dump            -> restores into $PGDATABASE (the live database!)
#   sh restore.sh /backups/writers-room-20261118-030000.dump restore_test -> restores into a fresh database "restore_test"
# Connection comes from the PG* environment variables. Restoring into the live database replaces its contents.
set -eu

DUMP=${1:?usage: restore.sh <dump file> [database]}
TARGET=${2:-${PGDATABASE:?PGDATABASE or a database argument is required}}

if [ ! -f "$DUMP" ]; then
  echo "No such file: $DUMP" >&2
  exit 1
fi

# Connect to the maintenance database to create the target if needed.
if ! psql -d postgres -tAc "select 1 from pg_database where datname = '$TARGET'" | grep -q 1; then
  echo "Creating database $TARGET"
  createdb "$TARGET"
fi

echo "Restoring $DUMP into $TARGET"
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$TARGET" "$DUMP"
echo "Done. Tables in $TARGET:"
psql -d "$TARGET" -c "select table_name, (xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || table_name, false, true, '')))[1]::text as rows from information_schema.tables where table_schema = 'public' order by 1"
