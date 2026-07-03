import type {VirtualDeviceKind} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {runBoundedParallel} from '../util/runBoundedParallel';
import {
    type ProjectedVirtualEntity,
    projectVirtualEntity,
    virtualEntityId
} from './entityProjection';
import type {SourceSnapshot} from './readModel';

export interface VirtualEntityResolution {
    deviceExternalId: string;
    roleKey: string;
    entity: ProjectedVirtualEntity;
    online: boolean;
    status: unknown;
    sourceDeviceExternalId: string;
    sourceComponentKey: string;
    writable: boolean;
}

export interface VirtualEntityOwnerSummary {
    deviceExternalId: string;
    entityCount: number;
}

export interface VirtualEntityResolverDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    getSourceSnapshot(
        externalId: string
    ): SourceSnapshot | null | Promise<SourceSnapshot | null>;
}

interface VirtualEntityRow {
    device_list_id: number;
    external_id: string;
    organization_id: string;
    kind: VirtualDeviceKind;
    role_key: string;
    source_device_list_id: number;
    source_external_id: string;
    source_component_key: string;
    writable: boolean | null;
    required: boolean | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
}

interface VirtualEntityOwnerRow {
    external_id: string;
    entity_count: number | string;
}

const defaultDeps: VirtualEntityResolverDeps = {
    queryRows: postgres.queryRows,
    getSourceSnapshot: () => null
};

export async function resolveVirtualEntity(
    input: {organizationId: string; entityId: string},
    deps: VirtualEntityResolverDeps = defaultDeps
): Promise<VirtualEntityResolution | null> {
    const rows = await deps.queryRows<VirtualEntityRow>(
        `${virtualEntitySelect()}
          WHERE vd.organization_id = $1
            AND vd.deleted_at IS NULL
            AND (${virtualEntityIdSql()} = $2 OR ${legacyVirtualEntityIdSql()} = $2)
          LIMIT 1`,
        [input.organizationId, input.entityId]
    );
    return rows[0] ? await rowToResolution(rows[0], deps) : null;
}

export async function listVirtualEntities(
    input: {
        organizationId: string;
        deviceExternalIds?: readonly string[];
        limit?: number;
        offset?: number;
    },
    deps: VirtualEntityResolverDeps = defaultDeps
): Promise<VirtualEntityResolution[]> {
    if (input.deviceExternalIds?.length === 0) return [];
    const query = listVirtualEntityQuery(input);
    const rows = await deps.queryRows<VirtualEntityRow>(
        query.sql,
        query.params
    );
    // User-facing list: surface a bad row's failure without waiting on the rest.
    const RESOLVE_CONCURRENCY = 8;
    const RESOLVE_PER_TASK_TIMEOUT_MS = 30_000;
    const settled = await runBoundedParallel({
        tasks: rows,
        run: (row) => rowToResolution(row, deps),
        concurrency: RESOLVE_CONCURRENCY,
        perTaskTimeoutMs: RESOLVE_PER_TASK_TIMEOUT_MS,
        label: 'virtual-entity-resolve',
        failFast: true
    });
    return settled
        .filter(
            (r): r is PromiseFulfilledResult<VirtualEntityResolution> =>
                r.status === 'fulfilled'
        )
        .map((r) => r.value);
}

export async function listVirtualEntityOwners(
    input: {organizationId: string},
    deps: Pick<VirtualEntityResolverDeps, 'queryRows'> = defaultDeps
): Promise<VirtualEntityOwnerSummary[]> {
    const rows = await deps.queryRows<VirtualEntityOwnerRow>(
        `${virtualEntityOwnerSelect()}
          WHERE vd.organization_id = $1
            AND vd.deleted_at IS NULL
          GROUP BY dl.external_id
          ORDER BY dl.external_id ASC`,
        [input.organizationId]
    );
    return rows.map(rowToOwnerSummary);
}

async function rowToResolution(
    row: VirtualEntityRow,
    deps: Pick<VirtualEntityResolverDeps, 'getSourceSnapshot'>
): Promise<VirtualEntityResolution> {
    const snapshot = await deps.getSourceSnapshot(row.source_external_id);
    const status = readComponentStatus(snapshot, row.source_component_key);
    const available = snapshot?.presence === 'online' && status !== null;
    const entity = projectVirtualEntity({
        device: {externalId: row.external_id},
        binding: {
            roleKey: row.role_key,
            sourceExternalId: row.source_external_id,
            sourceComponentKey: row.source_component_key,
            writable: row.writable,
            sourceSnapshot: row.source_snapshot_json,
            roleMetadata: row.role_metadata_json
        },
        available
    });
    return {
        deviceExternalId: row.external_id,
        roleKey: row.role_key,
        entity,
        online: available,
        status: status ?? {},
        sourceDeviceExternalId: row.source_external_id,
        sourceComponentKey: row.source_component_key,
        writable: row.writable === true
    };
}

function listVirtualEntityQuery(input: {
    organizationId: string;
    deviceExternalIds?: readonly string[];
    limit?: number;
    offset?: number;
}): {sql: string; params: unknown[]} {
    const params: unknown[] = [input.organizationId];
    const filters = ['vd.organization_id = $1', 'vd.deleted_at IS NULL'];
    if (input.deviceExternalIds) {
        params.push(input.deviceExternalIds);
        filters.push(`dl.external_id = ANY($${params.length}::text[])`);
    }

    let sql = `${virtualEntitySelect()}
          WHERE ${filters.join('\n            AND ')}
          ORDER BY dl.external_id ASC, b.role_key ASC`;
    if (input.limit !== undefined) {
        params.push(input.limit);
        sql += `\n          LIMIT $${params.length}`;
    }
    if (input.offset !== undefined && input.offset > 0) {
        params.push(input.offset);
        sql += `\n          OFFSET $${params.length}`;
    }
    return {sql, params};
}

function virtualEntitySelect(): string {
    return `SELECT
            vd.device_list_id,
            dl.external_id,
            vd.organization_id,
            vd.kind,
            b.role_key,
            b.source_device_list_id,
            src.external_id AS source_external_id,
            b.source_component_key,
            b.writable,
            b.required,
            b.source_snapshot_json,
            b.role_metadata_json
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
           JOIN device.virtual_device_binding b
             ON b.virtual_device_list_id = vd.device_list_id
            AND b.organization_id = vd.organization_id
            AND b.effective_to IS NULL
            AND b.effective_from <= NOW()
           JOIN device.list src
             ON src.id = b.source_device_list_id
            AND src.organization_id = b.organization_id`;
}

function virtualEntityOwnerSelect(): string {
    return `SELECT
            dl.external_id,
            COUNT(*)::integer AS entity_count
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
           JOIN device.virtual_device_binding b
             ON b.virtual_device_list_id = vd.device_list_id
            AND b.organization_id = vd.organization_id
            AND b.effective_to IS NULL
            AND b.effective_from <= NOW()`;
}

function virtualEntityIdSql(): string {
    return `(dl.external_id || ':role:' || b.role_key || ':virtual')`;
}

function legacyVirtualEntityIdSql(): string {
    return `(dl.external_id || '_' || b.role_key || ':virtual')`;
}

function readComponentStatus(
    snapshot: SourceSnapshot | null,
    componentKey: string
): unknown {
    if (!snapshot?.status) return null;
    const value = snapshot.status[componentKey];
    return value === undefined ? null : value;
}

function rowToOwnerSummary(
    row: VirtualEntityOwnerRow
): VirtualEntityOwnerSummary {
    return {
        deviceExternalId: row.external_id,
        entityCount: Number(row.entity_count)
    };
}

export function isVirtualEntityId(entityId: string): boolean {
    return entityId.endsWith(':virtual');
}

export {virtualEntityId};
