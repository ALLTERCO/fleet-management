import {randomBytes, randomUUID} from 'node:crypto';
import {buildListResponse, type ListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceCreateParams,
    VirtualDeviceDeleteParams,
    VirtualDeviceDto,
    VirtualDeviceKind,
    VirtualDeviceListParams,
    VirtualDeviceProfileRole,
    VirtualDeviceUpdateParams
} from '../../types/api/virtualdevice';
import {assertAssetBelongsToOrg} from '../asset/assetRepository';
import * as postgres from '../PostgresProvider';
import {createInitialVirtualDeviceBindings} from './bindingRepository';

export interface QueryClient {
    query<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

interface RepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    withTransaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T>;
    makeExternalId(): string;
    makeBindingId?: () => string;
}

interface VirtualDeviceRow {
    device_list_id: number;
    external_id: string;
    organization_id: string;
    kind: VirtualDeviceKind;
    name: string;
    type_key: string;
    category_key: string | null;
    profile_id: string | null;
    image_asset_id: string | null;
    location_id: number | null;
    group_ids: number[] | null;
    tag_ids: number[] | null;
    enabled: boolean;
    revision: number | string;
    visual_json: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    total_count?: number | string;
}

const CREATE_COLLISION_RETRIES = 5;

const defaultDeps: RepositoryDeps = {
    queryRows: postgres.queryRows,
    withTransaction: postgres.withQueryTransaction,
    makeExternalId: makeVirtualExternalId,
    makeBindingId: randomUUID
};

export function makeVirtualExternalId(): string {
    return `vdev_${randomBytes(16).toString('hex')}`;
}

export async function createVirtualDevice(
    input: VirtualDeviceCreateParams & {
        organizationId: string;
        actorId?: string | null;
    },
    deps: RepositoryDeps = defaultDeps
): Promise<VirtualDeviceDto> {
    await assertAssetBelongsToOrg(input.organizationId, input.imageAssetId);
    return retryExternalIdCollisions(() =>
        deps.withTransaction(async (tx) => {
            const externalId = deps.makeExternalId();
            const deviceRows = await tx.query<{id: number}>(
                `INSERT INTO device.list (
                    external_id,
                    control_access,
                    jdoc,
                    organization_id,
                    kind
                )
                VALUES ($1, 3, '{}'::jsonb, $2, $3)
                RETURNING id`,
                [externalId, input.organizationId, input.kind]
            );
            const deviceListId = deviceRows[0]?.id;
            if (!deviceListId) throw RpcError.OperationFailed('virtual create');

            const profileId = await resolveProfileIdForOrg(
                tx,
                input.organizationId,
                input.profileId
            );

            await tx.query(
                `INSERT INTO device.virtual_device (
                    device_list_id,
                    organization_id,
                    kind,
                    name,
                    type_key,
                    category_key,
                    profile_id,
                    image_asset_id,
                    visual_json,
                    metadata
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    deviceListId,
                    input.organizationId,
                    input.kind,
                    input.name.trim(),
                    input.typeKey,
                    input.categoryKey ?? null,
                    profileId,
                    input.imageAssetId ?? null,
                    input.visual ?? {},
                    input.metadata ?? {}
                ]
            );
            await replaceVirtualDeviceMemberships(tx, {
                organizationId: input.organizationId,
                externalId,
                locationId: input.locationId,
                groupIds: input.groupIds,
                tagIds: input.tagIds
            });
            if (input.bindings?.length) {
                await createInitialVirtualDeviceBindings(tx, {
                    organizationId: input.organizationId,
                    externalId,
                    deviceListId,
                    profileRoles: await loadProfileRoles(tx, profileId),
                    bindings: input.bindings,
                    actorId: input.actorId ?? null,
                    makeId: deps.makeBindingId ?? randomUUID
                });
            }
            const rows = await tx.query<VirtualDeviceRow>(
                `${virtualDeviceSelect()} WHERE vd.device_list_id = $1`,
                [deviceListId]
            );
            return rowToVirtualDevice(requireRow(rows, externalId));
        })
    );
}

async function loadProfileRoles(
    tx: QueryClient,
    profileId: string | null
): Promise<VirtualDeviceProfileRole[] | null> {
    if (!profileId) return null;
    const rows = await tx.query<{roles_json: unknown}>(
        `SELECT roles_json
           FROM device.virtual_device_profile
          WHERE id = $1
            AND deleted_at IS NULL
          LIMIT 1`,
        [profileId]
    );
    return Array.isArray(rows[0]?.roles_json)
        ? (rows[0].roles_json as VirtualDeviceProfileRole[])
        : null;
}

// virtual_device.profile_id references virtual_device_profile(id) alone, so
// a device may point at a same-org profile OR a shared system profile
// (organization_id IS NULL). Validate access here — the single-column FK
// guarantees existence but not tenant scoping.
async function resolveProfileIdForOrg(
    tx: QueryClient,
    organizationId: string,
    profileId: string | null | undefined
): Promise<string | null> {
    if (!profileId) return null;
    const rows = await tx.query<{id: string}>(
        `SELECT id
           FROM device.virtual_device_profile
          WHERE id = $1
            AND deleted_at IS NULL
            AND (organization_id = $2 OR organization_id IS NULL)
          LIMIT 1`,
        [profileId, organizationId]
    );
    if (!rows[0]) {
        throw RpcError.InvalidParams('profile not found for organization', [
            {field: 'profileId', error: profileId, code: 'profile_not_found'}
        ]);
    }
    return rows[0].id;
}

export async function getVirtualDevice(
    organizationId: string,
    externalId: string,
    deps: RepositoryDeps = defaultDeps
): Promise<VirtualDeviceDto | null> {
    const rows = await deps.queryRows<VirtualDeviceRow>(
        `${virtualDeviceSelect()}
         WHERE vd.organization_id = $1
           AND dl.external_id = $2
           AND vd.deleted_at IS NULL
         LIMIT 1`,
        [organizationId, externalId]
    );
    return rows[0] ? rowToVirtualDevice(rows[0]) : null;
}

export async function getVirtualDeviceByListId(
    tx: QueryClient,
    deviceListId: number
): Promise<VirtualDeviceDto> {
    const rows = await tx.query<VirtualDeviceRow>(
        `${virtualDeviceSelect()} WHERE vd.device_list_id = $1`,
        [deviceListId]
    );
    return rowToVirtualDevice(requireRow(rows, String(deviceListId)));
}

export async function listVirtualDevices(
    organizationId: string,
    params: VirtualDeviceListParams,
    deps: RepositoryDeps = defaultDeps
): Promise<ListResponse<VirtualDeviceDto>> {
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;
    const filters = buildListFilters(organizationId, params);
    const pagination = buildPaginationClause(filters.values.length, limit);
    const total = await countVirtualDevices(filters, deps);
    if (total === 0) return buildListResponse([], 0, limit, offset);
    const rows = await deps.queryRows<VirtualDeviceRow>(
        `${virtualDeviceSelect()}
         WHERE ${filters.where.join(' AND ')}
         ORDER BY ${sortExpression(params.sortBy)} ${sortDirection(params.sortDir)}
         ${pagination.sql}`,
        [...filters.values, ...pagination.params(offset)]
    );
    return buildListResponse(
        rows.map(rowToVirtualDevice),
        total,
        limit,
        offset
    );
}

async function countVirtualDevices(
    filters: {where: string[]; values: unknown[]},
    deps: RepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{total_count: number | string}>(
        `SELECT COUNT(*) AS total_count
         ${virtualDeviceFrom()}
         WHERE ${filters.where.join(' AND ')}`,
        filters.values
    );
    return Number(rows[0]?.total_count ?? 0);
}

function buildPaginationClause(
    filterValueCount: number,
    limit: number
): {sql: string; params: (offset: number) => unknown[]} {
    if (limit === 0) {
        return {
            sql: `OFFSET $${filterValueCount + 1}`,
            params: (offset) => [offset]
        };
    }
    return {
        sql: `LIMIT $${filterValueCount + 1} OFFSET $${filterValueCount + 2}`,
        params: (offset) => [limit, offset]
    };
}

export async function updateVirtualDevice(
    organizationId: string,
    input: VirtualDeviceUpdateParams,
    deps: RepositoryDeps = defaultDeps
): Promise<VirtualDeviceDto> {
    await assertAssetBelongsToOrg(organizationId, input.imageAssetId);
    // Distinguish "absent" (keep current) from "explicit null" (clear).
    const clearImage = input.imageAssetId === null;
    return deps.withTransaction(async (tx) => {
        const rows = await tx.query<VirtualDeviceRow>(
            `WITH updated AS (
                UPDATE device.virtual_device
                   SET name = COALESCE($3, name),
                       type_key = COALESCE($4, type_key),
                       category_key = COALESCE($5, category_key),
                       image_asset_id = CASE WHEN $11::boolean THEN NULL
                                             ELSE COALESCE($6, image_asset_id)
                                        END,
                       enabled = COALESCE($7, enabled),
                       visual_json = COALESCE($8, visual_json),
                       metadata = COALESCE($9, metadata),
                       revision = revision + 1,
                       updated_at = NOW()
                 WHERE organization_id = $1
                   AND device_list_id = (
                        SELECT id FROM device.list
                         WHERE organization_id = $1 AND external_id = $2
                   )
                   AND revision = $10
                   AND deleted_at IS NULL
                 RETURNING device_list_id
             )
             ${virtualDeviceSelect()}
             JOIN updated u ON u.device_list_id = vd.device_list_id`,
            [
                organizationId,
                input.externalId,
                input.name?.trim() ?? null,
                input.typeKey ?? null,
                input.categoryKey ?? null,
                input.imageAssetId ?? null,
                input.enabled ?? null,
                input.visual ?? null,
                input.metadata ?? null,
                input.expectedRevision,
                clearImage
            ]
        );
        const updated = await requireMutationRow(
            organizationId,
            input.externalId,
            rows,
            deps
        );
        await replaceVirtualDeviceMemberships(tx, {
            organizationId,
            externalId: input.externalId,
            locationId: input.locationId,
            groupIds: input.groupIds,
            tagIds: input.tagIds
        });
        const refreshed = await tx.query<VirtualDeviceRow>(
            `${virtualDeviceSelect()} WHERE vd.device_list_id = $1`,
            [updated.device_list_id]
        );
        return rowToVirtualDevice(requireRow(refreshed, input.externalId));
    });
}

export async function deleteVirtualDevice(
    organizationId: string,
    input: VirtualDeviceDeleteParams,
    deps: RepositoryDeps = defaultDeps
): Promise<{externalId: string; deleted: boolean}> {
    if (input.retention === 'purge') {
        await purgeVirtualDevice(organizationId, input, deps);
        return {externalId: input.externalId, deleted: true};
    }
    await tombstoneVirtualDevice(organizationId, input, deps);
    return {externalId: input.externalId, deleted: true};
}

async function tombstoneVirtualDevice(
    organizationId: string,
    input: VirtualDeviceDeleteParams,
    deps: RepositoryDeps
): Promise<void> {
    const rows = await deps.queryRows<{device_list_id: number}>(
        `UPDATE device.virtual_device
            SET deleted_at = NOW(),
                enabled = FALSE,
                revision = revision + 1,
                updated_at = NOW()
          WHERE organization_id = $1
            AND device_list_id = (
                SELECT id FROM device.list
                 WHERE organization_id = $1 AND external_id = $2
            )
            AND revision = $3
            AND deleted_at IS NULL
          RETURNING device_list_id`,
        [organizationId, input.externalId, input.expectedRevision]
    );
    await requireMutationRow(organizationId, input.externalId, rows, deps);
}

async function purgeVirtualDevice(
    organizationId: string,
    input: VirtualDeviceDeleteParams,
    deps: RepositoryDeps
): Promise<void> {
    await deps.withTransaction(async (tx) => {
        const rows = await tx.query<{device_list_id: number}>(
            `SELECT vd.device_list_id
               FROM device.virtual_device vd
               JOIN device.list dl ON dl.id = vd.device_list_id
              WHERE vd.organization_id = $1
                AND dl.external_id = $2
                AND vd.revision = $3
                AND vd.deleted_at IS NULL
              LIMIT 1`,
            [organizationId, input.externalId, input.expectedRevision]
        );
        if (!rows[0]) {
            await requireMutationRow(
                organizationId,
                input.externalId,
                rows,
                deps
            );
            return;
        }
        await tx.query(
            `DELETE FROM device.list
              WHERE id = $1 AND organization_id = $2`,
            [rows[0].device_list_id, organizationId]
        );
    });
}

function virtualDeviceSelect(): string {
    return `SELECT
        vd.device_list_id,
        dl.external_id,
        vd.organization_id,
        vd.kind,
        vd.name,
        vd.type_key,
        vd.category_key,
        vd.profile_id,
        vd.image_asset_id,
        la.location_id,
        COALESCE(gm.group_ids, '{}'::integer[]) AS group_ids,
        COALESCE(ta.tag_ids, '{}'::integer[]) AS tag_ids,
        vd.enabled,
        vd.revision,
        vd.visual_json,
        vd.metadata
      FROM device.virtual_device vd
      JOIN device.list dl
        ON dl.id = vd.device_list_id
       AND dl.organization_id = vd.organization_id
      LEFT JOIN organization.location_assignments la
        ON la.organization_id = vd.organization_id
       AND la.subject_type = 'device'
       AND la.subject_id = dl.external_id
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(group_id ORDER BY group_id) AS group_ids
          FROM organization.group_members
         WHERE organization_id = vd.organization_id
           AND subject_type = 'device'
           AND subject_id = dl.external_id
      ) gm ON TRUE
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(tag_id ORDER BY tag_id) AS tag_ids
          FROM organization.tag_assignments
         WHERE organization_id = vd.organization_id
           AND subject_type = 'device'
           AND subject_id = dl.external_id
      ) ta ON TRUE`;
}

function virtualDeviceFrom(): string {
    return `FROM device.virtual_device vd
      JOIN device.list dl
        ON dl.id = vd.device_list_id
       AND dl.organization_id = vd.organization_id`;
}

function rowToVirtualDevice(row: VirtualDeviceRow): VirtualDeviceDto {
    return {
        deviceListId: row.device_list_id,
        externalId: row.external_id,
        organizationId: row.organization_id,
        kind: row.kind,
        name: row.name,
        typeKey: row.type_key,
        categoryKey: row.category_key,
        profileId: row.profile_id,
        imageAssetId: row.image_asset_id,
        locationId: row.location_id,
        groupIds: row.group_ids ?? [],
        tagIds: row.tag_ids ?? [],
        enabled: row.enabled,
        revision: Number(row.revision),
        visual: row.visual_json ?? {},
        metadata: row.metadata ?? {}
    };
}

function buildListFilters(
    organizationId: string,
    params: VirtualDeviceListParams
): {where: string[]; values: unknown[]} {
    const values: unknown[] = [organizationId];
    const where = ['vd.organization_id = $1', 'vd.deleted_at IS NULL'];
    addFilter(where, values, 'vd.kind', params.kind);
    addFilter(where, values, 'vd.type_key', params.typeKey);
    addFilter(where, values, 'vd.category_key', params.categoryKey);
    if (params.query) {
        values.push(`%${params.query}%`);
        where.push(
            `(vd.name ILIKE $${values.length} OR dl.external_id ILIKE $${values.length})`
        );
    }
    return {where, values};
}

function addFilter(
    where: string[],
    values: unknown[],
    column: string,
    value: string | undefined
): void {
    if (!value) return;
    values.push(value);
    where.push(`${column} = $${values.length}`);
}

function sortExpression(sortBy: VirtualDeviceListParams['sortBy']): string {
    switch (sortBy) {
        case 'kind':
            return 'vd.kind';
        case 'typeKey':
            return 'vd.type_key';
        case 'categoryKey':
            return 'vd.category_key';
        case 'createdAt':
            return 'vd.created_at';
        default:
            return 'vd.name';
    }
}

function sortDirection(sortDir: VirtualDeviceListParams['sortDir']): string {
    return sortDir === 'desc' ? 'DESC' : 'ASC';
}

function requireRow(
    rows: VirtualDeviceRow[],
    externalId: string
): VirtualDeviceRow {
    const row = rows[0];
    if (!row) throw RpcError.NotFound('virtual_device', externalId);
    return row;
}

async function requireMutationRow<T>(
    organizationId: string,
    externalId: string,
    rows: T[],
    deps: RepositoryDeps
): Promise<T> {
    const row = rows[0];
    if (row) return row;
    const existing = await getVirtualDevice(organizationId, externalId, deps);
    if (!existing) throw RpcError.NotFound('virtual_device', externalId);
    throw RpcError.Domain('ResourceConflict', {
        message: 'virtual device revision conflict',
        details: {resourceType: 'virtual_device', identifier: externalId}
    });
}

async function retryExternalIdCollisions<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < CREATE_COLLISION_RETRIES; i++) {
        try {
            return await fn();
        } catch (err) {
            if (!isExternalIdConflict(err)) throw err;
            lastErr = err;
        }
    }
    throw RpcError.OperationFailed('virtual create', lastErr);
}

function isExternalIdConflict(err: unknown): boolean {
    return (
        !!err &&
        typeof err === 'object' &&
        (err as {code?: string}).code === '23505'
    );
}

interface MembershipPatch {
    organizationId: string;
    externalId: string;
    locationId?: number | null;
    groupIds?: number[];
    tagIds?: number[];
}

export async function replaceVirtualDeviceMemberships(
    tx: QueryClient,
    patch: MembershipPatch
): Promise<void> {
    await replaceLocationAssignment(tx, patch);
    await replaceGroupAssignments(tx, patch);
    await replaceTagAssignments(tx, patch);
}

async function replaceLocationAssignment(
    tx: QueryClient,
    patch: MembershipPatch
): Promise<void> {
    if (patch.locationId === undefined) return;
    await tx.query(
        `DELETE FROM organization.location_assignments
          WHERE organization_id = $1
            AND subject_type = 'device'
            AND subject_id = $2`,
        [patch.organizationId, patch.externalId]
    );
    if (patch.locationId === null) return;
    await assertLocationsBelongToOrg(tx, patch.organizationId, [
        patch.locationId
    ]);
    await tx.query(
        `INSERT INTO organization.location_assignments (
            organization_id,
            subject_type,
            subject_id,
            location_id
        )
        VALUES ($1, 'device', $2, $3)`,
        [patch.organizationId, patch.externalId, patch.locationId]
    );
}

async function replaceGroupAssignments(
    tx: QueryClient,
    patch: MembershipPatch
): Promise<void> {
    if (patch.groupIds === undefined) return;
    await assertGroupsBelongToOrg(tx, patch.organizationId, patch.groupIds);
    await tx.query(
        `DELETE FROM organization.group_members
          WHERE organization_id = $1
            AND subject_type = 'device'
            AND subject_id = $2`,
        [patch.organizationId, patch.externalId]
    );
    await insertGroupAssignments(tx, patch);
}

async function replaceTagAssignments(
    tx: QueryClient,
    patch: MembershipPatch
): Promise<void> {
    if (patch.tagIds === undefined) return;
    await assertTagsBelongToOrg(tx, patch.organizationId, patch.tagIds);
    await tx.query(
        `DELETE FROM organization.tag_assignments
          WHERE organization_id = $1
            AND subject_type = 'device'
            AND subject_id = $2`,
        [patch.organizationId, patch.externalId]
    );
    await insertTagAssignments(tx, patch);
}

async function assertLocationsBelongToOrg(
    tx: QueryClient,
    organizationId: string,
    inputIds: number[]
): Promise<void> {
    const ids = uniqueSortedIds(inputIds);
    if (ids.length === 0) return;
    const rows = await tx.query<{id: number}>(
        `SELECT id
           FROM organization.locations
          WHERE organization_id = $1
            AND id = ANY($2::integer[])`,
        [organizationId, ids]
    );
    assertAllIdsFound(rows, ids, 'location');
}

async function assertGroupsBelongToOrg(
    tx: QueryClient,
    organizationId: string,
    inputIds: number[]
): Promise<void> {
    const ids = uniqueSortedIds(inputIds);
    if (ids.length === 0) return;
    const rows = await tx.query<{id: number}>(
        `SELECT id
           FROM organization.groups
          WHERE organization_id = $1
            AND id = ANY($2::integer[])`,
        [organizationId, ids]
    );
    assertAllIdsFound(rows, ids, 'group');
}

async function assertTagsBelongToOrg(
    tx: QueryClient,
    organizationId: string,
    inputIds: number[]
): Promise<void> {
    const ids = uniqueSortedIds(inputIds);
    if (ids.length === 0) return;
    const rows = await tx.query<{id: number}>(
        `SELECT id
           FROM organization.tags
          WHERE organization_id = $1
            AND id = ANY($2::integer[])`,
        [organizationId, ids]
    );
    assertAllIdsFound(rows, ids, 'tag');
}

async function insertGroupAssignments(
    tx: QueryClient,
    patch: MembershipPatch
): Promise<void> {
    const ids = uniqueSortedIds(patch.groupIds ?? []);
    if (ids.length === 0) return;
    await tx.query(
        `INSERT INTO organization.group_members (
            organization_id,
            group_id,
            subject_type,
            subject_id
        )
        SELECT $1, UNNEST($2::integer[]), 'device', $3
        ON CONFLICT DO NOTHING`,
        [patch.organizationId, ids, patch.externalId]
    );
}

async function insertTagAssignments(
    tx: QueryClient,
    patch: MembershipPatch
): Promise<void> {
    const ids = uniqueSortedIds(patch.tagIds ?? []);
    if (ids.length === 0) return;
    await tx.query(
        `INSERT INTO organization.tag_assignments (
            organization_id,
            tag_id,
            subject_type,
            subject_id
        )
        SELECT $1, UNNEST($2::integer[]), 'device', $3
        ON CONFLICT DO NOTHING`,
        [patch.organizationId, ids, patch.externalId]
    );
}

function assertAllIdsFound(
    rows: readonly {id: number}[],
    ids: readonly number[],
    resource: string
): void {
    if (rows.length === ids.length) return;
    const found = new Set(rows.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    throw RpcError.NotFound(resource, missing.join(','));
}

function uniqueSortedIds(ids: readonly number[]): number[] {
    return Array.from(new Set(ids)).sort((a, b) => a - b);
}
