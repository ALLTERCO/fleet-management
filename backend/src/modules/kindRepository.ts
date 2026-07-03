// Single runtime source for kind rows. organization.kind holds built-ins
// (org NULL, seeded from groupKindCatalog.ts) and per-org custom kinds. Every
// reader goes through here, so kinds come from the one table the FKs point at.

import type {JsonSchema} from '../types/api/_schema';
import type {GroupKind} from '../types/api/group';
import type {KindAppliesTo, ResolvedKind} from './kindResolver';
import * as postgres from './PostgresProvider';

export interface KindRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

const defaultDeps: KindRepositoryDeps = {queryRows: postgres.queryRows};

// Full row of organization.kind shared by every mapper below.
interface KindRow {
    id: string;
    organization_id: string | null;
    display_name: string;
    description: string | null;
    category: string;
    icon: string | null;
    applies_to: string;
    metadata_schema: Record<string, unknown> | null;
    sort_order: number | string;
}

const READ_COLUMNS = `id, organization_id, display_name, description, category,
                      icon, applies_to, metadata_schema, sort_order`;

function toResolved(row: KindRow): ResolvedKind {
    return {
        id: row.id,
        name: row.display_name,
        category: row.category,
        icon: row.icon,
        appliesTo: row.applies_to as KindAppliesTo,
        source: row.organization_id === null ? 'vendor' : 'custom'
    };
}

function toGroupKind(row: KindRow): GroupKind {
    return {
        id: row.id,
        displayName: row.display_name,
        description: row.description,
        category: row.category,
        icon: row.icon,
        metadataSchema: row.metadata_schema ?? {},
        sortOrder: Number(row.sort_order)
    };
}

// Built-ins (org NULL) plus this org's own rows; null org = built-ins only.
function ownershipClause(organizationId: string | null, params: unknown[]) {
    if (organizationId === null) return 'organization_id IS NULL';
    params.push(organizationId);
    return `(organization_id IS NULL OR organization_id = $${params.length})`;
}

function matchesAxisClause(appliesTo: KindAppliesTo, params: unknown[]) {
    params.push(appliesTo);
    const n = params.length;
    return `(applies_to = $${n} OR applies_to = 'both' OR $${n} = 'both')`;
}

// ── Resolver-facing reads (built-in OR this org's custom) ────────────────────

export async function loadKind(
    id: string,
    organizationId: string,
    deps: KindRepositoryDeps = defaultDeps
): Promise<ResolvedKind | null> {
    const row = await loadRow(id, organizationId, deps);
    return row ? toResolved(row) : null;
}

export async function listKinds(
    organizationId: string,
    appliesTo: KindAppliesTo,
    deps: KindRepositoryDeps = defaultDeps
): Promise<ResolvedKind[]> {
    const params: unknown[] = [];
    const where = [
        ownershipClause(organizationId, params),
        matchesAxisClause(appliesTo, params)
    ].join(' AND ');
    const rows = await deps.queryRows<KindRow>(
        `SELECT ${READ_COLUMNS} FROM organization.kind WHERE ${where}
          ORDER BY sort_order ASC, id ASC`,
        params
    );
    return rows.map(toResolved);
}

// Display name per kind id (built-in or this org's custom), for labelling.
// Ids absent from the table are simply omitted.
export async function displayNamesFor(
    ids: readonly string[],
    organizationId: string,
    deps: KindRepositoryDeps = defaultDeps
): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const params: unknown[] = [[...ids]];
    const rows = await deps.queryRows<{id: string; display_name: string}>(
        `SELECT id, display_name FROM organization.kind
          WHERE id = ANY($1::text[])
            AND ${ownershipClause(organizationId, params)}`,
        params
    );
    return new Map(rows.map((r) => [r.id, r.display_name]));
}

// The kind's metadata schema, or null when the kind is unknown for the org.
export async function loadKindSchema(
    id: string,
    organizationId: string,
    deps: KindRepositoryDeps = defaultDeps
): Promise<JsonSchema | null> {
    const row = await loadRow(id, organizationId, deps);
    return row ? ((row.metadata_schema ?? {}) as JsonSchema) : null;
}

// Shared by-id read, scoped to built-ins + the org's rows (null = built-ins).
async function loadRow(
    id: string,
    organizationId: string | null,
    deps: KindRepositoryDeps
): Promise<KindRow | null> {
    const params: unknown[] = [id];
    const rows = await deps.queryRows<KindRow>(
        `SELECT ${READ_COLUMNS} FROM organization.kind
          WHERE id = $1 AND ${ownershipClause(organizationId, params)} LIMIT 1`,
        params
    );
    return rows[0] ?? null;
}

// ── Group picker (group-applicable kinds, richer GroupKind shape) ────────────

export interface ListGroupKindsFilter {
    organizationId?: string | null;
    category?: string;
    query?: string;
}

export async function listGroupKinds(
    filter: ListGroupKindsFilter,
    deps: KindRepositoryDeps = defaultDeps
): Promise<GroupKind[]> {
    const params: unknown[] = [];
    const clauses = [
        ownershipClause(filter.organizationId ?? null, params),
        `applies_to IN ('group', 'both')`
    ];
    if (filter.category) {
        params.push(filter.category);
        clauses.push(`category = $${params.length}`);
    }
    if (filter.query) {
        params.push(`%${filter.query}%`);
        clauses.push(
            `(display_name ILIKE $${params.length} OR description ILIKE $${params.length})`
        );
    }
    const rows = await deps.queryRows<KindRow>(
        `SELECT ${READ_COLUMNS} FROM organization.kind
          WHERE ${clauses.join(' AND ')}
          ORDER BY sort_order ASC, id ASC`,
        params
    );
    return rows.map(toGroupKind);
}

export async function getGroupKind(
    id: string,
    organizationId: string | null,
    deps: KindRepositoryDeps = defaultDeps
): Promise<GroupKind | null> {
    const row = await loadRow(id, organizationId, deps);
    return row ? toGroupKind(row) : null;
}

// ── Custom-kind writes (org-owned rows only) ─────────────────────────────────

export interface CustomKindWriteFields {
    name: string;
    category: string;
    icon: string | null;
    appliesTo: KindAppliesTo;
}

// org_<id>:<slug> — unique per org, never collides with vendor bare slugs.
export function customKindId(organizationId: string, slug: string): string {
    return `org_${organizationId}:${slug}`;
}

// Postgres unique_violation: the (org, slug) pair is taken.
export function isDuplicateSlugError(err: unknown): boolean {
    return (err as {code?: string} | null)?.code === '23505';
}

export async function createCustomKind(
    organizationId: string,
    slug: string,
    fields: CustomKindWriteFields,
    deps: KindRepositoryDeps = defaultDeps
): Promise<ResolvedKind> {
    // FK to organization.profile — ensure the parent row exists first, else a
    // first-time org hits a raw FK-violation 500.
    await deps.queryRows('SELECT organization.fn_profile_ensure($1)', [
        organizationId
    ]);
    const rows = await deps.queryRows<KindRow>(
        `INSERT INTO organization.kind
            (id, organization_id, slug, display_name, category, icon, applies_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${READ_COLUMNS}`,
        [
            customKindId(organizationId, slug),
            organizationId,
            slug,
            fields.name,
            fields.category,
            fields.icon,
            fields.appliesTo
        ]
    );
    return toResolved(rows[0]);
}

export async function updateCustomKind(
    id: string,
    organizationId: string,
    fields: CustomKindWriteFields,
    deps: KindRepositoryDeps = defaultDeps
): Promise<ResolvedKind | null> {
    const rows = await deps.queryRows<KindRow>(
        `UPDATE organization.kind
            SET display_name = $3, category = $4, icon = $5, applies_to = $6,
                updated_at = NOW()
         WHERE id = $1 AND organization_id = $2
         RETURNING ${READ_COLUMNS}`,
        [
            id,
            organizationId,
            fields.name,
            fields.category,
            fields.icon,
            fields.appliesTo
        ]
    );
    return rows[0] ? toResolved(rows[0]) : null;
}

// Atomic guarded delete: a device/group classified mid-call makes it no-op
// rather than raise a raw FK violation. False = missing or still referenced.
export async function deleteCustomKind(
    id: string,
    organizationId: string,
    deps: KindRepositoryDeps = defaultDeps
): Promise<boolean> {
    const rows = await deps.queryRows<{id: string}>(
        `DELETE FROM organization.kind k
         WHERE k.id = $1 AND k.organization_id = $2
           AND NOT EXISTS (
               SELECT 1 FROM device.list WHERE catalog_kind = k.id)
           AND NOT EXISTS (
               SELECT 1 FROM organization.groups WHERE kind = k.id)
         RETURNING k.id`,
        [id, organizationId]
    );
    return rows.length > 0;
}

// ── Reference counting ───────────────────────────────────────────────────────

// Distinct custom kinds assigned to a device or group, fleet-wide. Backs the
// custom_kind_in_use gauge; one scalar avoids stale per-kind labels. `org\_%`
// escapes the LIKE wildcard.
export async function countCustomKindsInUse(
    deps: KindRepositoryDeps = defaultDeps
): Promise<number> {
    const rows = await deps.queryRows<{n: string | number}>(
        `SELECT count(*) AS n FROM (
             SELECT catalog_kind AS kind FROM device.list
               WHERE catalog_kind LIKE 'org\\_%'
             UNION
             SELECT kind FROM organization.groups
               WHERE kind LIKE 'org\\_%'
         ) AS used`
    );
    return Number(rows[0]?.n ?? 0);
}

// How many devices + groups currently reference this kind id. Delete is
// blocked while this is non-zero.
export async function countKindReferences(
    id: string,
    deps: KindRepositoryDeps = defaultDeps
): Promise<number> {
    const rows = await deps.queryRows<{n: string | number}>(
        `SELECT (SELECT count(*) FROM device.list WHERE catalog_kind = $1)
              + (SELECT count(*) FROM organization.groups WHERE kind = $1)
              AS n`,
        [id]
    );
    return Number(rows[0]?.n ?? 0);
}
