# Backups

The `backup` service in `docker-compose.yml` runs `pg_dump` every night at `BACKUP_TIME` (default 03:00, container clock, UTC) and once on start. Dumps land in `./backups/` on the host as `writers-room-YYYYMMDD-HHMMSS.dump` (Postgres custom format, compressed). Dumps older than `BACKUP_KEEP_DAYS` (default 30) are deleted. Script history inside the database is never pruned; this only limits how many nightly files are kept on disk.

Copy `./backups/` somewhere off the server (another machine, object storage) on a schedule of its own. A backup that lives only on the server it protects is not a backup.

## Take a backup now

```bash
docker compose run --rm backup sh /scripts/backup.sh now
```

## Check that a backup restores (do this monthly)

Restores into a fresh database called `restore_test` next to the live one:

```bash
docker compose exec backup sh /scripts/restore.sh /backups/<file>.dump restore_test
```

The script prints the tables and row counts it restored. Drop the test database afterwards:

```bash
docker compose exec db dropdb -U writers_room restore_test
```

## Restore the live database after a disaster

1. Stop the app so nobody writes during the restore: `docker compose stop server web`.
2. Restore over the live database (this replaces its contents):
   ```bash
   docker compose exec backup sh /scripts/restore.sh /backups/<file>.dump writers_room
   ```
3. Start the app again: `docker compose start server web`.

## Without Docker

`deploy/backup/backup.sh` and `restore.sh` are plain shell scripts that need only `pg_dump`, `pg_restore`, `psql` and `createdb`. Point them at any database with the usual `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` variables and `BACKUP_DIR`.
