import {randomUUID} from 'node:crypto';
import {buildListResponse, type ListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceProfileCreateParams,
    VirtualDeviceProfileDto,
    VirtualDeviceProfileListParams,
    VirtualDeviceProfileMetadata,
    VirtualDeviceProfileRole,
    VirtualDeviceProfileUpdateParams
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';
import {jsonbParam} from '../postgresJsonb';

interface ProfileRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
    makeId(): string;
}

interface ProfileRow {
    id: string;
    organization_id: string | null;
    key: string;
    name: string;
    version: number | string;
    roles_json: VirtualDeviceProfileRole[];
    metadata: VirtualDeviceProfileMetadata | null;
    total_count?: number | string;
}

export interface ProfileValidationResult {
    valid: boolean;
    errors: Array<{field: string; error: string; code: string}>;
}

const defaultDeps: ProfileRepositoryDeps = {
    queryRows: postgres.queryRows,
    makeId: randomUUID
};

export function validateProfileRoles(
    roles: readonly VirtualDeviceProfileRole[]
): ProfileValidationResult {
    const errors: ProfileValidationResult['errors'] = [];
    const seen = new Set<string>();
    roles.forEach((role, index) => {
        const field = `roles.${index}`;
        if (seen.has(role.roleKey)) {
            errors.push({
                field: `${field}.roleKey`,
                error: 'roleKey must be unique',
                code: 'duplicate_role'
            });
        }
        seen.add(role.roleKey);
        if (role.valueType !== 'number' && role.unit !== undefined) {
            errors.push({
                field: `${field}.unit`,
                error: 'unit is allowed only for numeric roles',
                code: 'unit_requires_number'
            });
        }
        if (role.historyMode === 'derived' && role.writable === true) {
            errors.push({
                field: `${field}.writable`,
                error: 'derived roles cannot be directly writable',
                code: 'derived_not_writable'
            });
        }
    });
    return {valid: errors.length === 0, errors};
}

export type PerOrgProfileInput = VirtualDeviceProfileCreateParams & {
    organizationId: string;
};

export type SystemProfileInput = VirtualDeviceProfileCreateParams & {
    organizationId?: null;
};

export async function createPerOrgProfile(
    input: PerOrgProfileInput,
    deps: ProfileRepositoryDeps = defaultDeps
): Promise<VirtualDeviceProfileDto> {
    assertValidProfileRoles(input.roles);
    const row = await insertProfileRow(input, input.organizationId, deps);
    if (!row) throw RpcError.OperationFailed('virtual profile create');
    return rowToProfile(row);
}

export interface UpsertSystemProfileResult {
    profile: VirtualDeviceProfileDto;
    inserted: boolean;
}

export async function upsertSystemProfile(
    input: SystemProfileInput,
    deps: ProfileRepositoryDeps = defaultDeps
): Promise<UpsertSystemProfileResult> {
    assertValidProfileRoles(input.roles);
    const insertedRow = await insertSystemProfileRow(input, deps);
    if (insertedRow) {
        return {profile: rowToProfile(insertedRow), inserted: true};
    }
    const existing = await readSystemProfileRow(input.key, input.version, deps);
    if (!existing) throw RpcError.OperationFailed('virtual profile upsert');
    return {profile: rowToProfile(existing), inserted: false};
}

function assertValidProfileRoles(
    roles: readonly VirtualDeviceProfileRole[]
): void {
    const validation = validateProfileRoles(roles);
    if (validation.valid) return;
    throw RpcError.InvalidParams('Invalid profile roles', validation.errors);
}

async function insertProfileRow(
    input: VirtualDeviceProfileCreateParams,
    organizationId: string | null,
    deps: ProfileRepositoryDeps
): Promise<ProfileRow | undefined> {
    const rows = await deps.queryRows<ProfileRow>(
        `INSERT INTO device.virtual_device_profile (
            id,
            organization_id,
            key,
            name,
            version,
            roles_json,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, organization_id, key, name, version, roles_json, metadata`,
        buildInsertParams(input, organizationId, deps.makeId())
    );
    return rows[0];
}

// Matches the partial unique index on (key, version) WHERE
// organization_id IS NULL AND deleted_at IS NULL.
async function insertSystemProfileRow(
    input: SystemProfileInput,
    deps: ProfileRepositoryDeps
): Promise<ProfileRow | undefined> {
    return runInsertOrAbsorbUniqueConflict(input, deps);
}

async function runInsertOrAbsorbUniqueConflict(
    input: SystemProfileInput,
    deps: ProfileRepositoryDeps
): Promise<ProfileRow | undefined> {
    try {
        return await runSystemProfileInsert(input, deps);
    } catch (err) {
        if (isUniqueViolation(err)) return undefined;
        throw err;
    }
}

async function runSystemProfileInsert(
    input: SystemProfileInput,
    deps: ProfileRepositoryDeps
): Promise<ProfileRow | undefined> {
    const rows = await deps.queryRows<ProfileRow>(
        `INSERT INTO device.virtual_device_profile (
            id,
            organization_id,
            key,
            name,
            version,
            roles_json,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (key, version) WHERE organization_id IS NULL AND deleted_at IS NULL
            DO NOTHING
        RETURNING id, organization_id, key, name, version, roles_json, metadata`,
        buildInsertParams(input, null, deps.makeId())
    );
    return rows[0];
}

function isUniqueViolation(err: unknown): boolean {
    return (
        !!err &&
        typeof err === 'object' &&
        (err as {code?: string}).code === '23505'
    );
}

async function readSystemProfileRow(
    key: string,
    version: number | undefined,
    deps: ProfileRepositoryDeps
): Promise<ProfileRow | undefined> {
    const rows = await deps.queryRows<ProfileRow>(
        `SELECT id, organization_id, key, name, version, roles_json, metadata
           FROM device.virtual_device_profile
          WHERE organization_id IS NULL
            AND deleted_at IS NULL
            AND key = $1
            AND version = $2`,
        [key, version ?? 1]
    );
    return rows[0];
}

function buildInsertParams(
    input: VirtualDeviceProfileCreateParams,
    organizationId: string | null,
    id: string
): unknown[] {
    return [
        id,
        organizationId,
        input.key,
        input.name.trim(),
        input.version ?? 1,
        jsonbParam(input.roles),
        jsonbParam(input.metadata ?? {})
    ];
}

export async function listVirtualDeviceProfiles(
    organizationId: string,
    params: VirtualDeviceProfileListParams,
    deps: ProfileRepositoryDeps = defaultDeps
): Promise<ListResponse<VirtualDeviceProfileDto>> {
    const limit = params.limit ?? 200;
    const offset = params.offset ?? 0;
    const filters = buildProfileFilters(organizationId, params);
    const total = await countProfiles(filters, deps);
    if (total === 0) return buildListResponse([], 0, limit, offset);
    const pagination = buildPaginationClause(filters.values.length, limit);
    const rows = await deps.queryRows<ProfileRow>(
        `SELECT id, organization_id, key, name, version, roles_json, metadata
           FROM device.virtual_device_profile
          WHERE ${filters.where.join(' AND ')}
          ORDER BY key ASC, version DESC
          ${pagination.sql}`,
        [...filters.values, ...pagination.params(offset)]
    );
    return buildListResponse(rows.map(rowToProfile), total, limit, offset);
}

async function countProfiles(
    filters: {where: string[]; values: unknown[]},
    deps: ProfileRepositoryDeps
): Promise<number> {
    const rows = await deps.queryRows<{total_count: number | string}>(
        `SELECT COUNT(*) AS total_count
           FROM device.virtual_device_profile
          WHERE ${filters.where.join(' AND ')}`,
        filters.values
    );
    return Number(rows[0]?.total_count ?? 0);
}

function buildProfileFilters(
    organizationId: string,
    params: VirtualDeviceProfileListParams
): {where: string[]; values: unknown[]} {
    // System profiles (organization_id IS NULL) are visible to every org.
    const where = [
        '(organization_id = $1 OR organization_id IS NULL)',
        'deleted_at IS NULL'
    ];
    const values: unknown[] = [organizationId];
    if (params.query) {
        values.push(`%${params.query}%`);
        where.push(
            `(key ILIKE $${values.length} OR name ILIKE $${values.length})`
        );
    }
    return {where, values};
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

function rowToProfile(row: ProfileRow): VirtualDeviceProfileDto {
    return {
        id: row.id,
        organizationId: row.organization_id,
        key: row.key,
        name: row.name,
        version: Number(row.version),
        roles: row.roles_json ?? [],
        metadata: row.metadata ?? {}
    };
}

// Returns null for missing rows. System profiles (organization_id IS NULL)
// are visible to every org via the OR clause; per-org rows are tenant-scoped.
export async function getProfileById(
    organizationId: string,
    profileId: string,
    deps: ProfileRepositoryDeps = defaultDeps
): Promise<VirtualDeviceProfileDto | null> {
    const rows = await deps.queryRows<ProfileRow>(
        `SELECT id, organization_id, key, name, version, roles_json, metadata
           FROM device.virtual_device_profile
          WHERE id = $1
            AND deleted_at IS NULL
            AND (organization_id = $2 OR organization_id IS NULL)
          LIMIT 1`,
        [profileId, organizationId]
    );
    return rows[0] ? rowToProfile(rows[0]) : null;
}

// Per-org rows only. System profiles are rejected with NotFound so callers
// can't smuggle edits via Update; the seeder owns them.
export async function updatePerOrgProfile(
    organizationId: string,
    input: VirtualDeviceProfileUpdateParams,
    deps: ProfileRepositoryDeps = defaultDeps
): Promise<VirtualDeviceProfileDto> {
    const sets: string[] = [];
    const values: unknown[] = [input.profileId, organizationId];
    if (input.name !== undefined) {
        values.push(input.name.trim());
        sets.push(`name = $${values.length}`);
    }
    if (input.metadata !== undefined) {
        // SHALLOW JSONB merge — preserves top-level keys the caller didn't
        // touch (e.g. categoryKey survives a defaultVisual-only patch), but
        // nested objects under matching keys are REPLACED whole. Callers
        // patching defaultVisual must send the full desired defaultVisual.
        values.push(jsonbParam(input.metadata));
        sets.push(
            `metadata = COALESCE(metadata, '{}'::jsonb) || $${values.length}::jsonb`
        );
    }
    if (sets.length === 0) {
        const existing = await getProfileById(
            organizationId,
            input.profileId,
            deps
        );
        if (!existing || existing.organizationId === null) {
            throw RpcError.NotFound('virtual_device_profile', input.profileId);
        }
        return existing;
    }
    const rows = await deps.queryRows<ProfileRow>(
        `UPDATE device.virtual_device_profile
            SET ${sets.join(', ')}
          WHERE id = $1
            AND organization_id = $2
            AND deleted_at IS NULL
          RETURNING id, organization_id, key, name, version, roles_json, metadata`,
        values
    );
    if (!rows[0])
        throw RpcError.NotFound('virtual_device_profile', input.profileId);
    return rowToProfile(rows[0]);
}
