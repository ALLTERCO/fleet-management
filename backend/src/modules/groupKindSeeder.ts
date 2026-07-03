// Boot-time seeder. UPSERTs every entry from GROUP_KIND_CATALOG into the
// built-in tier of organization.kind (organization_id NULL) so the DB matches
// the TS source of truth on every start. Custom kinds (org-owned rows) are
// never touched. Idempotent.

import {
    GROUP_KIND_CATALOG,
    type GroupKindDefinition
} from '../config/groupKindCatalog';
import * as postgres from './PostgresProvider';
import {jsonbParam} from './postgresJsonb';

interface SeederDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

const defaultDeps: SeederDeps = {queryRows: postgres.queryRows};

export async function seedGroupKindCatalog(
    deps: SeederDeps = defaultDeps
): Promise<{upserted: number; pruned: number}> {
    for (const kind of GROUP_KIND_CATALOG) {
        await upsertOne(kind, deps);
    }
    const pruned = await pruneOrphanBuiltins(deps);
    return {upserted: GROUP_KIND_CATALOG.length, pruned};
}

// Drop built-in rows whose id left the catalog, so the table stays an exact
// projection of GROUP_KIND_CATALOG. A still-referenced row is kept (deleting it
// would FK-violate). Custom rows are untouched.
async function pruneOrphanBuiltins(deps: SeederDeps): Promise<number> {
    const ids = GROUP_KIND_CATALOG.map((k) => k.id);
    const removed = await deps.queryRows<{id: string}>(
        `DELETE FROM organization.kind k
          WHERE k.organization_id IS NULL
            AND k.id <> ALL($1::text[])
            AND NOT EXISTS (
                SELECT 1 FROM device.list WHERE catalog_kind = k.id)
            AND NOT EXISTS (
                SELECT 1 FROM organization.groups WHERE kind = k.id)
          RETURNING k.id`,
        [ids]
    );
    return removed.length;
}

async function upsertOne(
    kind: GroupKindDefinition,
    deps: SeederDeps
): Promise<void> {
    await deps.queryRows(
        `INSERT INTO organization.kind
            (id, organization_id, slug, display_name, description, category,
             icon, applies_to, metadata_schema, metrics, sort_order, updated_at)
         VALUES ($1, NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (id) DO UPDATE SET
             display_name    = EXCLUDED.display_name,
             description     = EXCLUDED.description,
             category        = EXCLUDED.category,
             icon            = EXCLUDED.icon,
             applies_to      = EXCLUDED.applies_to,
             metadata_schema = EXCLUDED.metadata_schema,
             metrics         = EXCLUDED.metrics,
             sort_order      = EXCLUDED.sort_order,
             updated_at      = now()`,
        [
            kind.id,
            kind.displayName,
            kind.description,
            kind.category,
            kind.icon,
            kind.appliesTo ?? 'group',
            jsonbParam(kind.metadataSchema),
            kind.metrics ? jsonbParam(kind.metrics) : null,
            kind.sortOrder
        ]
    );
}
