import {toIso} from '../rpc/pgRows';
import RpcError from '../rpc/RpcError';
import type {
    ServesGetParams,
    ServesLink,
    ServesListParams,
    ServesRelation,
    ServesSetParams,
    ServesSourceRef,
    ServesTargetInput,
    ServesTargetRef,
    ServesUnsetParams
} from '../types/api/serves';
import * as postgres from './PostgresProvider';

export interface ServesRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction<T>(
        fn: (client: postgres.QueryTxClient) => Promise<T>
    ): Promise<T>;
}

interface ServesRow {
    id: number | string;
    source_kind: ServesSourceRef['kind'];
    source_id: string;
    target_kind: ServesTargetRef['kind'];
    target_id: string;
    relation: ServesRelation;
    weight: number | string | null;
    created_at: Date | string;
    updated_at: Date | string;
}

interface DeleteCountRow {
    deleted: number | string;
}

const DEFAULT_RELATION: ServesRelation = 'serves:serves';

const defaultDeps: ServesRepositoryDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction
};

export async function setServesLinks(
    organizationId: string,
    params: ServesSetParams,
    deps: ServesRepositoryDeps = defaultDeps
): Promise<ServesLink[]> {
    const relation = params.relation ?? DEFAULT_RELATION;
    await assertSourceExists(organizationId, params.source, deps);
    await assertTargetsAllowed(
        organizationId,
        params.source,
        params.targets,
        deps
    );
    await rejectReciprocalLinks(
        organizationId,
        params.source,
        params.targets,
        relation,
        deps
    );
    const rows = await deps.withTransaction((client) =>
        upsertServesLinks(client, {
            organizationId,
            source: params.source,
            targets: params.targets,
            relation
        })
    );
    return rows.map(rowToServesLink);
}

export async function unsetServesLinks(
    organizationId: string,
    params: ServesUnsetParams,
    deps: ServesRepositoryDeps = defaultDeps
): Promise<number> {
    await assertSourceExists(organizationId, params.source, deps);
    const rows =
        params.source.kind === 'device'
            ? await deleteDeviceServes(organizationId, params, deps)
            : await deleteGroupServes(organizationId, params, deps);
    return Number(rows[0]?.deleted ?? 0);
}

export async function listServesLinks(
    organizationId: string,
    params: ServesListParams,
    deps: ServesRepositoryDeps = defaultDeps
): Promise<ServesLink[]> {
    assertOneListFilter(params);
    const rows = params.source
        ? await listBySource(organizationId, params.source, deps)
        : await listByTarget(
              organizationId,
              params.target as ServesTargetRef,
              deps
          );
    return rows.map(rowToServesLink);
}

export async function getServesLink(
    organizationId: string,
    params: ServesGetParams,
    deps: ServesRepositoryDeps = defaultDeps
): Promise<ServesLink | null> {
    const relation = params.relation ?? DEFAULT_RELATION;
    const rows =
        params.source.kind === 'device'
            ? await getDeviceServesLink(organizationId, params, relation, deps)
            : await getGroupServesLink(organizationId, params, relation, deps);
    return rows[0] ? rowToServesLink(rows[0]) : null;
}

function assertOneListFilter(params: ServesListParams): void {
    if (!!params.source === !!params.target) {
        throw RpcError.InvalidParams('serves.List requires source or target');
    }
}

async function assertTargetsAllowed(
    organizationId: string,
    source: ServesSourceRef,
    targets: readonly ServesTargetInput[],
    deps: ServesRepositoryDeps
): Promise<void> {
    for (const target of targets) {
        assertSourceCanTarget(source, target);
        await assertTargetExists(organizationId, target, deps);
    }
}

function assertSourceCanTarget(
    source: ServesSourceRef,
    target: ServesTargetInput
): void {
    if (source.kind === 'group' && target.kind === 'device') {
        throw RpcError.InvalidParams('group serves targets cannot be devices');
    }
    if (source.kind === target.kind && source.id === target.id) {
        throw RpcError.InvalidParams('serves source cannot target itself');
    }
    if (
        target.weight !== undefined &&
        target.weight !== null &&
        target.weight < 1
    ) {
        throw RpcError.InvalidParams('serves target weight must be >= 1');
    }
}

async function assertSourceExists(
    organizationId: string,
    source: ServesSourceRef,
    deps: ServesRepositoryDeps
): Promise<void> {
    if (source.kind === 'device') {
        await assertDeviceExists(organizationId, source.id, deps);
        return;
    }
    await assertGroupExists(organizationId, source.id, deps);
}

async function assertTargetExists(
    organizationId: string,
    target: ServesTargetRef,
    deps: ServesRepositoryDeps
): Promise<void> {
    if (target.kind === 'device') {
        await assertDeviceExists(organizationId, target.id, deps);
        return;
    }
    if (target.kind === 'group') {
        await assertGroupExists(organizationId, target.id, deps);
        return;
    }
    await assertLocationExists(organizationId, target.id, deps);
}

async function assertDeviceExists(
    organizationId: string,
    id: string,
    deps: ServesRepositoryDeps
): Promise<void> {
    const rows = await deps.queryRows(
        `SELECT 1 FROM device.list
          WHERE organization_id = $1 AND external_id = $2
          LIMIT 1`,
        [organizationId, id]
    );
    if (rows.length === 0) throw RpcError.NotFound('device', id);
}

async function assertGroupExists(
    organizationId: string,
    id: string,
    deps: ServesRepositoryDeps
): Promise<void> {
    const rows = await deps.queryRows(
        `SELECT 1 FROM organization.groups
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [organizationId, positiveIntegerId('group', id)]
    );
    if (rows.length === 0) throw RpcError.NotFound('group', id);
}

async function assertLocationExists(
    organizationId: string,
    id: string,
    deps: ServesRepositoryDeps
): Promise<void> {
    const rows = await deps.queryRows(
        `SELECT 1 FROM organization.locations
          WHERE organization_id = $1 AND id = $2
          LIMIT 1`,
        [organizationId, positiveIntegerId('location', id)]
    );
    if (rows.length === 0) throw RpcError.NotFound('location', id);
}

function positiveIntegerId(kind: string, id: string): number {
    if (!/^[1-9]\d*$/.test(id)) {
        throw RpcError.InvalidParams(`${kind} id must be a positive integer`);
    }
    return Number(id);
}

async function rejectReciprocalLinks(
    organizationId: string,
    source: ServesSourceRef,
    targets: readonly ServesTargetInput[],
    relation: ServesRelation,
    deps: ServesRepositoryDeps
): Promise<void> {
    for (const target of targets) {
        if (!canHaveReciprocal(source, target)) continue;
        const rows = await reciprocalRows(
            organizationId,
            source,
            target,
            relation,
            deps
        );
        if (rows.length > 0) {
            throw RpcError.InvalidParams(
                'reciprocal serves link is not allowed'
            );
        }
    }
}

function canHaveReciprocal(
    source: ServesSourceRef,
    target: ServesTargetRef
): boolean {
    return source.kind === target.kind;
}

async function reciprocalRows(
    organizationId: string,
    source: ServesSourceRef,
    target: ServesTargetRef,
    relation: ServesRelation,
    deps: ServesRepositoryDeps
): Promise<unknown[]> {
    if (source.kind === 'device' && target.kind === 'device') {
        return await deps.queryRows(
            `SELECT 1 FROM device.v_device_serves_api
              WHERE organization_id = $1
                AND source_device_id = $2
                AND target_kind = 'device'
                AND target_id = $3
                AND relation = $4
              LIMIT 1`,
            [organizationId, target.id, source.id, relation]
        );
    }
    if (source.kind === 'group' && target.kind === 'group') {
        return await deps.queryRows(
            `SELECT 1 FROM organization.group_serves
              WHERE organization_id = $1
                AND source_group_id = $2
                AND target_kind = 'group'
                AND target_id = $3
                AND relation = $4
              LIMIT 1`,
            [
                organizationId,
                positiveIntegerId('group', target.id),
                source.id,
                relation
            ]
        );
    }
    return [];
}

async function upsertServesLinks(
    client: postgres.QueryTxClient,
    input: {
        organizationId: string;
        source: ServesSourceRef;
        targets: readonly ServesTargetInput[];
        relation: ServesRelation;
    }
): Promise<ServesRow[]> {
    const rows: ServesRow[] = [];
    for (const target of input.targets) {
        rows.push(
            ...(input.source.kind === 'device'
                ? await upsertDeviceServes(client, input, target)
                : await upsertGroupServes(client, input, target))
        );
    }
    return rows;
}

async function upsertDeviceServes(
    client: postgres.QueryTxClient,
    input: {
        organizationId: string;
        source: ServesSourceRef;
        relation: ServesRelation;
    },
    target: ServesTargetInput
): Promise<ServesRow[]> {
    return await client.query<ServesRow>(
        `INSERT INTO device.device_serves
            (organization_id, source_device_id, target_kind, target_id,
             source_device_ref, target_device_ref, relation, weight)
         VALUES (
             $1, $2, $3, $4,
             organization.fn_resolve_device_id($1, $2),
             CASE WHEN $3 = 'device'
                  THEN organization.fn_resolve_device_id($1, $4)
                  ELSE NULL END,
             $5, $6
         )
         ON CONFLICT DO UPDATE
         SET source_device_id = EXCLUDED.source_device_id,
             target_id = EXCLUDED.target_id,
             source_device_ref = EXCLUDED.source_device_ref,
             target_device_ref = EXCLUDED.target_device_ref,
             weight = EXCLUDED.weight,
             updated_at = NOW()
         RETURNING id, 'device' AS source_kind, $2::text AS source_id,
                   target_kind, $4::text AS target_id, relation, weight,
                   created_at, updated_at`,
        [
            input.organizationId,
            input.source.id,
            target.kind,
            target.id,
            input.relation,
            target.weight ?? null
        ]
    );
}

async function upsertGroupServes(
    client: postgres.QueryTxClient,
    input: {
        organizationId: string;
        source: ServesSourceRef;
        relation: ServesRelation;
    },
    target: ServesTargetInput
): Promise<ServesRow[]> {
    return await client.query<ServesRow>(
        `INSERT INTO organization.group_serves
            (organization_id, source_group_id, target_kind, target_id, relation, weight)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, source_group_id, target_kind, target_id, relation)
         DO UPDATE SET weight = EXCLUDED.weight, updated_at = NOW()
         RETURNING id, 'group' AS source_kind, source_group_id::text AS source_id,
                   target_kind, target_id, relation, weight, created_at, updated_at`,
        [
            input.organizationId,
            positiveIntegerId('group', input.source.id),
            target.kind,
            target.id,
            input.relation,
            target.weight ?? null
        ]
    );
}

async function deleteDeviceServes(
    organizationId: string,
    params: ServesUnsetParams,
    deps: ServesRepositoryDeps
): Promise<DeleteCountRow[]> {
    return await deps.queryRows<DeleteCountRow>(
        `WITH deleted AS (
             DELETE FROM device.device_serves
              WHERE organization_id = $1
                AND source_device_ref = organization.fn_resolve_device_id($1, $2)
                AND ($3::text IS NULL OR target_kind = $3)
                AND (
                    $4::text IS NULL
                    OR ($3 = 'device' AND target_device_ref =
                        organization.fn_resolve_device_id($1, $4))
                    OR ($3 <> 'device' AND target_id = $4)
                )
                AND ($5::text IS NULL OR relation = $5)
              RETURNING 1
         )
         SELECT count(*) AS deleted FROM deleted`,
        [
            organizationId,
            params.source.id,
            params.target?.kind ?? null,
            params.target?.id ?? null,
            params.relation ?? null
        ]
    );
}

async function deleteGroupServes(
    organizationId: string,
    params: ServesUnsetParams,
    deps: ServesRepositoryDeps
): Promise<DeleteCountRow[]> {
    return await deps.queryRows<DeleteCountRow>(
        `WITH deleted AS (
             DELETE FROM organization.group_serves
              WHERE organization_id = $1
                AND source_group_id = $2
                AND ($3::text IS NULL OR target_kind = $3)
                AND ($4::text IS NULL OR target_id = $4)
                AND ($5::text IS NULL OR relation = $5)
              RETURNING 1
         )
         SELECT count(*) AS deleted FROM deleted`,
        [
            organizationId,
            positiveIntegerId('group', params.source.id),
            params.target?.kind ?? null,
            params.target?.id ?? null,
            params.relation ?? null
        ]
    );
}

async function listBySource(
    organizationId: string,
    source: ServesSourceRef,
    deps: ServesRepositoryDeps
): Promise<ServesRow[]> {
    if (source.kind === 'device') {
        return await deps.queryRows<ServesRow>(
            `SELECT id, 'device' AS source_kind, source_device_id AS source_id,
                    target_kind, target_id, relation, weight, created_at, updated_at
               FROM device.v_device_serves_api
              WHERE organization_id = $1 AND source_device_id = $2
              ORDER BY relation, target_kind, target_id
              LIMIT 500`,
            [organizationId, source.id]
        );
    }
    return await deps.queryRows<ServesRow>(
        `SELECT id, 'group' AS source_kind, source_group_id::text AS source_id,
                target_kind, target_id, relation, weight, created_at, updated_at
           FROM organization.group_serves
          WHERE organization_id = $1 AND source_group_id = $2
          ORDER BY relation, target_kind, target_id
          LIMIT 500`,
        [organizationId, positiveIntegerId('group', source.id)]
    );
}

async function listByTarget(
    organizationId: string,
    target: ServesTargetRef,
    deps: ServesRepositoryDeps
): Promise<ServesRow[]> {
    const rows = await Promise.all([
        listDeviceServesByTarget(organizationId, target, deps),
        listGroupServesByTarget(organizationId, target, deps)
    ]);
    return rows.flat().sort(compareServesRows);
}

async function listDeviceServesByTarget(
    organizationId: string,
    target: ServesTargetRef,
    deps: ServesRepositoryDeps
): Promise<ServesRow[]> {
    return await deps.queryRows<ServesRow>(
        `SELECT id, 'device' AS source_kind, source_device_id AS source_id,
                target_kind, target_id, relation, weight, created_at, updated_at
           FROM device.v_device_serves_api
          WHERE organization_id = $1 AND target_kind = $2 AND target_id = $3
          ORDER BY relation, source_device_id
          LIMIT 500`,
        [organizationId, target.kind, target.id]
    );
}

async function listGroupServesByTarget(
    organizationId: string,
    target: ServesTargetRef,
    deps: ServesRepositoryDeps
): Promise<ServesRow[]> {
    if (target.kind === 'device') return [];
    return await deps.queryRows<ServesRow>(
        `SELECT id, 'group' AS source_kind, source_group_id::text AS source_id,
                target_kind, target_id, relation, weight, created_at, updated_at
           FROM organization.group_serves
          WHERE organization_id = $1 AND target_kind = $2 AND target_id = $3
          ORDER BY relation, source_group_id
          LIMIT 500`,
        [organizationId, target.kind, target.id]
    );
}

async function getDeviceServesLink(
    organizationId: string,
    params: ServesGetParams,
    relation: ServesRelation,
    deps: ServesRepositoryDeps
): Promise<ServesRow[]> {
    return await deps.queryRows<ServesRow>(
        `SELECT id, 'device' AS source_kind, source_device_id AS source_id,
                target_kind, target_id, relation, weight, created_at, updated_at
           FROM device.v_device_serves_api
          WHERE organization_id = $1
            AND source_device_id = $2
            AND target_kind = $3
            AND target_id = $4
            AND relation = $5
          LIMIT 1`,
        [
            organizationId,
            params.source.id,
            params.target.kind,
            params.target.id,
            relation
        ]
    );
}

async function getGroupServesLink(
    organizationId: string,
    params: ServesGetParams,
    relation: ServesRelation,
    deps: ServesRepositoryDeps
): Promise<ServesRow[]> {
    return await deps.queryRows<ServesRow>(
        `SELECT id, 'group' AS source_kind, source_group_id::text AS source_id,
                target_kind, target_id, relation, weight, created_at, updated_at
           FROM organization.group_serves
          WHERE organization_id = $1
            AND source_group_id = $2
            AND target_kind = $3
            AND target_id = $4
            AND relation = $5
          LIMIT 1`,
        [
            organizationId,
            positiveIntegerId('group', params.source.id),
            params.target.kind,
            params.target.id,
            relation
        ]
    );
}

function rowToServesLink(row: ServesRow): ServesLink {
    return {
        id: Number(row.id),
        source: {kind: row.source_kind, id: row.source_id},
        target: {kind: row.target_kind, id: row.target_id},
        relation: row.relation,
        weight: row.weight == null ? null : Number(row.weight),
        createdAt: toIso(row.created_at) ?? '',
        updatedAt: toIso(row.updated_at) ?? ''
    };
}

function compareServesRows(a: ServesRow, b: ServesRow): number {
    return (
        a.relation.localeCompare(b.relation) ||
        a.source_kind.localeCompare(b.source_kind) ||
        a.source_id.localeCompare(b.source_id) ||
        a.target_kind.localeCompare(b.target_kind) ||
        a.target_id.localeCompare(b.target_id)
    );
}
