<!-- audience: public -->
# Fleet Management, Rollback Procedure

How to recover from a bad update or broken deployment.

## Before You Start

Fleet Management stores all persistent data in Docker volumes and the `deploy/state/` directory. By default, `rollback` replaces the Fleet database with the latest pre-update dump, so data written after that dump was taken is lost. Use `--image-only` if you want to keep the current database (this is safe only when the new version did not change the schema).

Container, volume and project names below use the public default project `fleet-public`. Most containers are named `<COMPOSE_PROJECT_NAME>-<service>-1`; a few use a fixed name, such as `fm-redis`.

## Quick Rollback (Last Upgrade)

`upgrade` tags the running image as `shellygroup/fleet-management:rollback` and makes a pre-update database dump in `deploy/state/backups/`. To go back:

```bash
./deploy/deploy-public.sh rollback
```

By default this restores the latest pre-update database dump, then starts the rollback image. It refuses to run when no usable dump exists.

- `rollback --backup PATH` restores a dump you choose.
- `rollback --image-only` swaps the image and does not touch the database.

`upgrade` already does this on its own when the image swap, health check, smoke test, migration audit or soak check fails. It does not undo Zitadel, Redis, other images or `deploy/state/` changes.

To run an older Fleet Manager version by choice, pin it in `deploy/env/public.env` (`FM_VERSION=v1.80.0`). The `FM_VERSION` value in `deploy/VERSIONS.env` does not pin it, because the value from `public.env` wins. Then run `./deploy/deploy-public.sh up`. Take a database dump first (see the checklist below), because an older version may not run on a newer schema.

## Rolling Back a Database Migration

Fleet Manager runs database migrations automatically on startup. If a migration breaks things:

```bash
# 1. Stop Fleet Manager (keeps databases running)
docker stop fleet-public-fleet-manager-1

# 2. Check the migration ledger for what ran (newest first)
docker exec fleet-public-fleet-db-1 psql -U postgres -d fleet \
  -c 'SELECT id, name FROM migration."migration.list" ORDER BY id DESC LIMIT 10;'

# 3. If the last migration is the problem, apply a manual fix:
docker exec -i fleet-public-fleet-db-1 psql -U postgres -d fleet <<< "YOUR SQL FIX HERE"

# 4. Pin the previous FM version in deploy/env/public.env and restart
./deploy/deploy-public.sh up
```

> **Note:** Automatic migration rollback is not supported. If a migration created destructive changes (dropped columns, etc.), you need a database backup to recover. See [Backups](../deployment.md#backups) in the deployment guide.

### Known rollback hazards

Some `DOWN` sections re-add a narrower `CHECK` constraint and will fail if newer rows already use a value the older constraint forbade. Delete or rewrite those rows before rolling the migration back.

- **`20011_alert_kind_entity_state`**: the `DOWN` re-adds the `alert_rules` / `alert_instances` kind `CHECK` without `entity_state`. If any `entity_state` rule or instance exists, `ADD CONSTRAINT` errors. Before rolling back:

  ```sql
  DELETE FROM notifications.alert_instances WHERE rule_kind = 'entity_state';
  DELETE FROM notifications.alert_rules     WHERE kind = 'entity_state';
  ```

- **`7358_tariff_commodity`**: an older schema cannot represent water, gas,
  or heat tariffs. Migration `7363_tariff_commodity_rollback_archive` archives
  the complete non-electric tariff graph before its `DOWN` finishes and keeps
  that archive after rollback. Do not change those tariffs to electricity.
  Before a manual rollback, inspect and prepare one organization explicitly:

  ```sql
  SELECT * FROM organization.fn_tariff_commodity_rollback_prepare('org-id');
  SELECT * FROM organization.fn_tariff_commodity_rollback_status('org-id');
  ```

  After applying `7358` through `7363` again, restore that organization and
  inspect the result:

  ```sql
  SELECT * FROM organization.fn_tariff_commodity_rollback_restore('org-id');
  SELECT * FROM organization.fn_tariff_commodity_rollback_status('org-id');
  ```

  A restore returns no rows only when every archived row was restored exactly.
  ID or content conflicts remain in the archive for operator review; recovery
  never overwrites a live row and never silently relabels a commodity. Live
  price time-series rows remain in place under their preserved tariff IDs. A
  later rollback attempt also fails closed if an unresolved archive key has
  been reused with different content. Resolve or export that pending evidence
  before retrying; the prepare step will not replace it.

## Full Rollback From Backup

If data is corrupted or a migration can't be fixed in-place:

```bash
# 1. Pin the previous working version in deploy/env/public.env, for example:
#    FM_VERSION=v1.80.0

# 2. Restore a dump. This stops Fleet Manager, replaces the fleet database
#    with pg_restore, starts Fleet Manager and waits for health.
./deploy/deploy-public.sh backup-db list
./deploy/deploy-public.sh backup-db restore deploy/state/backups/<file>.dump --yes
```

The script dumps are `pg_dump -Fc` `.dump` files. Do not feed them to `psql`. The restore command also runs the TimescaleDB pre- and post-restore steps. If you must restore by hand, use `pg_restore`, not `psql <`.

## Zitadel Rollback

Zitadel manages its own database (`zitadel-db`). If Zitadel is broken:

```bash
# Pin the previous Zitadel version in deploy/VERSIONS.env
# e.g. ZITADEL_VERSION=v4.15.3

# Recreate the stack with the new pin
./deploy/deploy-public.sh up
```

Zitadel upgrades can be staged: a v2 to v4 move goes through an intermediate v3 version and PostgreSQL 17 first (see `ZITADEL_STAGE_VERSION` in `deploy/VERSIONS.env` and `deploy-public.sh migrate --plan-only`). Pinning an older Zitadel does not undo a database change it already made. To go back after a Zitadel migration, you need a backup of the Zitadel database volume (`fleet-public_zitadel-db-data`). `backup-db` covers only the Fleet database.

## Prevention: Pre-Update Checklist

1. **Backup the database and the deploy state** before any update. `upgrade` also makes its own dump. Each successful `upgrade` trims `deploy/state/backups/` to the newest 5 dumps, manual ones included, so copy one elsewhere if you want to keep it:

   ```bash
   ./deploy/deploy-public.sh backup-db create --label before-update
   ./deploy/deploy-public.sh backup-state --age-recipient FILE
   ```

   `backup-db create` writes a `pg_dump -Fc` file to `deploy/state/backups/`. `backup-state` saves `deploy/state/` (secrets, keys, certificates).

2. **Pin versions** instead of using `latest`. Pin Fleet Manager in `deploy/env/public.env` and Zitadel in `deploy/VERSIONS.env`:

   ```text
   FM_VERSION=v1.90.0          # deploy/env/public.env
   ZITADEL_VERSION=v4.15.3     # deploy/VERSIONS.env
   ```

3. **Test in staging** if available, run the update on a non-production instance first.

4. **Check the** [release notes](https://github.com/ALLTERCO/fleet-management/releases) for breaking changes before updating.

## Emergency: Container Won't Start

If a container is crash-looping after an update:

```bash
# Check what's wrong
docker logs fleet-public-fleet-manager-1 --tail 50

# Go back to the previous image and the pre-update database dump
./deploy/deploy-public.sh rollback
# Add --image-only to keep the current database
```

### MCP executor leases (`20093_mcp_operation_recovery`)

Migration 20093 adds executor ownership and lease expiry to existing MCP operation
receipts. Its `DOWN` removes the new functions, index and two columns while
preserving receipts and the older operation functions. Stop all code using the
new lease API before applying `DOWN`; that code cannot run against migration
20092 alone. Unknown receipts retain their keys across rollback. They do not
become eligible for automatic execution.

Reapplying `UP` restores the lease API. Previously running receipts have no lease
owner after `DOWN`; maintenance treats them as unknown once their original start
time exceeds the lease grace period. Neither direction proves whether an
external action finished. Inspect the target before authorizing another action.
The focused PostgreSQL test exercises `DOWN` and `UP` inside a rolled-back test
transaction. Follow the tenant backup and immutable-secret checks before any
real rollback.
