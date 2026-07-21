# Fleet Management — Rollback Procedure

How to recover from a bad update or broken deployment.

## Before You Start

Fleet Management stores all persistent data in Docker volumes and the `deploy/state/` directory. A rollback changes the application version but **never loses data** unless you explicitly pass `--volumes`.

## Quick Rollback (Pin Previous Version)

If an update broke something and you need the previous working version:

```bash
# 1. Check what version is running now
docker inspect fm-fleet-manager-1 --format '{{.Config.Image}}'

# 2. Edit VERSIONS.env to pin the last known-good version
#    Change FM_VERSION=latest to the last known-good Fleet Manager version,
#    for example FM_VERSION=v1.80.0
nano deploy/VERSIONS.env

# 3. Pull and restart with the pinned version
./deploy/deploy-public.sh update
```

## Rolling Back a Database Migration

Fleet Manager runs database migrations automatically on startup. If a migration breaks things:

```bash
# 1. Stop Fleet Manager (keeps databases running)
docker stop fm-fleet-manager-1

# 2. Check the migration ledger for what ran (newest first)
docker exec fm-fleet-db-1 psql -U postgres -d fleet \
  -c 'SELECT id, name FROM migration."migration.list" ORDER BY id DESC LIMIT 10;'

# 3. If the last migration is the problem, apply a manual fix:
docker exec -i fm-fleet-db-1 psql -U postgres -d fleet <<< "YOUR SQL FIX HERE"

# 4. Pin the previous FM version in VERSIONS.env and restart
./deploy/deploy-public.sh update
```

> **Note:** Automatic migration rollback is not supported. If a migration created destructive changes (dropped columns, etc.), you need a database backup to recover. See [backups.md](backups.md).

### Known rollback hazards

Some `DOWN` sections re-add a narrower `CHECK` constraint and will fail if newer rows already use a value the older constraint forbade. Delete or rewrite those rows before rolling the migration back.

- **`20011_alert_kind_entity_state`** — the `DOWN` re-adds the `alert_rules` / `alert_instances` kind `CHECK` without `entity_state`. If any `entity_state` rule or instance exists, `ADD CONSTRAINT` errors. Before rolling back:

  ```sql
  DELETE FROM notifications.alert_instances WHERE rule_kind = 'entity_state';
  DELETE FROM notifications.alert_rules     WHERE kind = 'entity_state';
  ```

## Full Rollback From Backup

If data is corrupted or a migration can't be fixed in-place:

```bash
# 1. Stop everything
./deploy/deploy-public.sh down

# 2. Remove the fleet-db volume (DESTRUCTIVE — only if you have a backup)
docker volume rm fm_fleet-db-data

# 3. Pin the previous working version
# Edit deploy/VERSIONS.env, for example: FM_VERSION=v1.80.0

# 4. Start fresh — this recreates the DB volume
./deploy/deploy-public.sh up

# 5. Restore from your pg_dump backup
docker exec -i fm-fleet-db-1 psql -U postgres -d fleet < backup.sql
```

## Zitadel Rollback

Zitadel manages its own database (`zitadel-db`). If Zitadel is broken:

```bash
# Pin the previous Zitadel version in VERSIONS.env
# e.g. ZITADEL_VERSION=v4.15.3

# Restart just Zitadel
docker compose -p fm restart zitadel
```

Zitadel migrations are generally backwards-compatible. If a Zitadel migration truly breaks, you need to restore `fm_zitadel-db-data` from backup and pin the old version.

## Prevention: Pre-Update Checklist

1. **Backup the database** before any update:

   ```bash
   docker exec fm-fleet-db-1 pg_dump -U postgres -d fleet > "backup-$(date +%F).sql"
   ```

2. **Pin versions** in `deploy/VERSIONS.env` instead of using `latest`:

   ```text
   FM_VERSION=v1.90.0
   ZITADEL_VERSION=v4.15.3
   ```

3. **Test in staging** if available — run the update on a non-production instance first.

4. **Check the changelog** at [docs/CHANGELOG.md](CHANGELOG.md) for breaking changes before updating.

## Emergency: Container Won't Start

If a container is crash-looping after an update:

```bash
# Check what's wrong
docker logs fm-fleet-manager-1 --tail 50

# Force remove and recreate with previous image
docker rm -f fm-fleet-manager-1
# Edit VERSIONS.env to pin old version, then:
./deploy/deploy-public.sh update
```
