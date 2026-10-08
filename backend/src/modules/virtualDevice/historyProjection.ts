// Project source status samples onto materialized/derived virtual roles.

import RpcError from '../../rpc/RpcError';
import * as postgres from '../PostgresProvider';
import {
    applyTransform,
    type ProjectionTransform,
    parseTransform
} from './projectionTransform';
import {
    resolveRoleProjection,
    type VirtualRoleProjection
} from './roleProjection';
import {organizationHasStoredProjections} from './virtualProjectionRouteCache';

export type {ProjectionTransform};
export {applyTransform, parseTransform};

const FIELD_PATTERN = /^[a-zA-Z][\w:.-]*$/;

export interface ProjectSourceStatusSampleInput {
    organizationId: string;
    sourceDeviceListId: number;
    sourceExternalId: string;
    sourceComponentKey: string;
    field: string;
    value: unknown;
    prevValue?: unknown;
    ts: string;
}

export interface ProjectionResult {
    projected: number;
    skipped: number;
}

export interface ProjectionDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

interface AffectedBindingRow {
    binding_id: string;
    virtual_device_list_id: number;
    role_key: string;
    mode: 'linked' | 'materialized' | 'derived' | 'live_only';
    transform_json: Record<string, unknown> | null;
    value_type: 'boolean' | 'number' | 'string' | 'event' | 'json' | null;
    unit?: string | null;
    source_snapshot_json?: Record<string, unknown> | null;
    role_metadata_json?: Record<string, unknown> | null;
}

const defaultDeps: ProjectionDeps = {
    queryRows: postgres.queryRows
};
const SOURCE_TARGET_KEY_SEPARATOR = '\0';

export async function projectSourceStatusSample(
    input: ProjectSourceStatusSampleInput,
    deps: ProjectionDeps = defaultDeps
): Promise<ProjectionResult> {
    assertFieldSafe(input.field);
    const bindings = await loadAffectedBindings(input, deps);
    if (bindings.length === 0) return {projected: 0, skipped: 0};

    let projected = 0;
    let skipped = 0;
    for (const binding of bindings) {
        const projection = bindingProjection(input, binding);
        if (input.field !== projection.valuePath) continue;
        const transformed = applyTransform(input.value, projection.transform);
        if ('skip' in transformed) {
            skipped++;
            continue;
        }
        if (!isValueValid(transformed.value, binding.value_type)) {
            skipped++;
            continue;
        }
        const result = await writeProjectedRow(
            {
                ...input,
                value: transformed.value,
                prevValue: transformedPreviousValue(
                    input.prevValue,
                    projection.transform
                )
            },
            binding,
            projection,
            deps
        );
        if (result === 'inserted') projected++;
        else skipped++;
    }
    return {projected, skipped};
}

// Batch entry as emitted by the status drainer.
export interface ProjectionBatchEntry {
    sourceDeviceListId: number;
    /** Source tenant when known; unknown entries always reach the lookup. */
    organizationId?: string;
    field: string;
    value: unknown;
    prevValue?: unknown;
    ts: string;
}

interface BatchBindingRow {
    binding_id: string;
    virtual_device_list_id: number;
    role_key: string;
    mode: 'linked' | 'materialized' | 'derived' | 'live_only';
    transform_json: Record<string, unknown> | null;
    value_type: 'boolean' | 'number' | 'string' | 'event' | 'json' | null;
    organization_id: string;
    source_device_list_id: number;
    source_component_key: string;
    source_external_id: string;
    unit: string | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
}

export async function projectStatusBatch(
    entries: readonly ProjectionBatchEntry[],
    deps: ProjectionDeps = defaultDeps
): Promise<ProjectionResult> {
    const targets = collectTargets(
        await entriesWithStoredProjections(entries, deps)
    );
    if (targets.size === 0) return {projected: 0, skipped: 0};
    const bindings = await loadBindingsForBatch(targets, deps);
    if (bindings.length === 0) return {projected: 0, skipped: 0};
    const byTarget = indexBindingsBySource(bindings);

    let projected = 0;
    let skipped = 0;
    for (const entry of entries) {
        const split = splitFieldKey(entry.field);
        if (!split) continue;
        const matches =
            byTarget.get(
                sourceTargetKey(entry.sourceDeviceListId, split.componentKey)
            ) ?? [];
        for (const binding of matches) {
            const projection = bindingProjection(
                {
                    sourceComponentKey: split.componentKey,
                    field: split.field
                },
                binding
            );
            if (split.field !== projection.valuePath) continue;
            const result = await applyAndWrite(
                {
                    organizationId: binding.organization_id,
                    sourceDeviceListId: entry.sourceDeviceListId,
                    sourceExternalId: binding.source_external_id,
                    sourceComponentKey: split.componentKey,
                    field: split.field,
                    value: entry.value,
                    prevValue: entry.prevValue,
                    ts: entry.ts
                },
                binding,
                projection,
                deps
            );
            projected += result.projected;
            skipped += result.skipped;
        }
    }
    return {projected, skipped};
}

// Most organizations store no projected history; their entries skip the
// binding lookup that would otherwise run for every persisted batch.
async function entriesWithStoredProjections(
    entries: readonly ProjectionBatchEntry[],
    deps: ProjectionDeps
): Promise<ProjectionBatchEntry[]> {
    const organizations = [
        ...new Set(
            entries.flatMap((entry) =>
                entry.organizationId ? [entry.organizationId] : []
            )
        )
    ];
    if (organizations.length === 0) return [...entries];
    const stored = new Set<string>();
    await Promise.all(
        organizations.map(async (organizationId) => {
            const present = await organizationHasStoredProjections(
                organizationId,
                (id) => loadHasStoredProjections(id, deps)
            );
            if (present) stored.add(organizationId);
        })
    );
    return entries.filter(
        (entry) => !entry.organizationId || stored.has(entry.organizationId)
    );
}

// Counts bindings not yet effective too: the cached answer must hold until a
// future-dated binding starts.
async function loadHasStoredProjections(
    organizationId: string,
    deps: ProjectionDeps
): Promise<boolean> {
    const rows = await deps.queryRows<{stored_projections: boolean}>(
        `SELECT EXISTS (
            SELECT 1
              FROM device.virtual_device_binding b
             WHERE b.organization_id = $1
               AND b.effective_to IS NULL
               AND b.mode IN ('materialized', 'derived')
        ) AS stored_projections`,
        [organizationId]
    );
    return rows[0]?.stored_projections === true;
}

function collectTargets(
    entries: readonly ProjectionBatchEntry[]
): Map<string, {deviceListId: number; componentKey: string}> {
    const out = new Map<string, {deviceListId: number; componentKey: string}>();
    for (const entry of entries) {
        const split = splitFieldKey(entry.field);
        if (!split) continue;
        out.set(sourceTargetKey(entry.sourceDeviceListId, split.componentKey), {
            deviceListId: entry.sourceDeviceListId,
            componentKey: split.componentKey
        });
    }
    return out;
}

async function loadBindingsForBatch(
    targets: Map<string, {deviceListId: number; componentKey: string}>,
    deps: ProjectionDeps
): Promise<BatchBindingRow[]> {
    // UNNEST pairs (id, key) to avoid the ANY/ANY cross-product.
    const ids: number[] = [];
    const keys: string[] = [];
    for (const t of targets.values()) {
        ids.push(t.deviceListId);
        keys.push(t.componentKey);
    }
    return deps.queryRows<BatchBindingRow>(
        `WITH targets AS (
            SELECT * FROM UNNEST($1::integer[], $2::varchar[])
                AS t(source_device_list_id, source_component_key)
        )
        SELECT
            b.id AS binding_id,
            b.virtual_device_list_id,
            b.role_key,
            b.mode,
            b.transform_json,
            b.value_type,
            b.unit,
            b.source_snapshot_json,
            b.role_metadata_json,
            b.organization_id,
            b.source_device_list_id,
            b.source_component_key,
            src.external_id AS source_external_id
           FROM device.virtual_device_binding b
           JOIN targets t
             ON t.source_device_list_id = b.source_device_list_id
            AND t.source_component_key = b.source_component_key
           JOIN device.list src
             ON src.id = b.source_device_list_id
            AND src.organization_id = b.organization_id
          WHERE b.effective_to IS NULL
            AND b.effective_from <= NOW()
            AND b.mode IN ('materialized', 'derived')`,
        [ids, keys]
    );
}

function indexBindingsBySource(
    bindings: readonly BatchBindingRow[]
): Map<string, BatchBindingRow[]> {
    const out = new Map<string, BatchBindingRow[]>();
    for (const b of bindings) {
        const key = sourceTargetKey(
            b.source_device_list_id,
            b.source_component_key
        );
        const bucket = out.get(key) ?? [];
        bucket.push(b);
        out.set(key, bucket);
    }
    return out;
}

function sourceTargetKey(deviceListId: number, componentKey: string): string {
    return `${deviceListId}${SOURCE_TARGET_KEY_SEPARATOR}${componentKey}`;
}

async function applyAndWrite(
    input: ProjectSourceStatusSampleInput,
    binding: BatchBindingRow,
    projection: VirtualRoleProjection,
    deps: ProjectionDeps
): Promise<ProjectionResult> {
    assertFieldSafe(input.field);
    const transformed = applyTransform(input.value, projection.transform);
    if ('skip' in transformed) return {projected: 0, skipped: 1};
    if (!isValueValid(transformed.value, binding.value_type)) {
        return {projected: 0, skipped: 1};
    }
    const result = await writeProjectedRow(
        {
            ...input,
            value: transformed.value,
            prevValue: transformedPreviousValue(
                input.prevValue,
                projection.transform
            )
        },
        binding,
        projection,
        deps
    );
    return result === 'inserted'
        ? {projected: 1, skipped: 0}
        : {projected: 0, skipped: 1};
}

function splitFieldKey(
    field: string
): {componentKey: string; field: string} | null {
    const dot = field.indexOf('.');
    if (dot <= 0 || dot === field.length - 1) return null;
    const componentKey = field.slice(0, dot);
    if (!/^[a-z][a-z0-9_]*:\d+$/.test(componentKey)) return null;
    return {componentKey, field: field.slice(dot + 1)};
}

function isValueValid(
    value: unknown,
    valueType: AffectedBindingRow['value_type']
): boolean {
    if (value === null || value === undefined) return false;
    switch (valueType) {
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'string':
            return typeof value === 'string' && value.length <= 4096;
        case 'event':
        case 'json':
        case null:
            return true;
    }
}

function transformedPreviousValue(
    value: unknown,
    transform: ProjectionTransform
): unknown {
    if (value === null || value === undefined) return null;
    const transformed = applyTransform(value, transform);
    return 'skip' in transformed ? null : transformed.value;
}

async function loadAffectedBindings(
    input: ProjectSourceStatusSampleInput,
    deps: ProjectionDeps
): Promise<AffectedBindingRow[]> {
    return deps.queryRows<AffectedBindingRow>(
        `SELECT
            b.id AS binding_id,
            b.virtual_device_list_id,
            b.role_key,
            b.mode,
            b.transform_json,
            b.value_type,
            b.unit,
            b.source_snapshot_json,
            b.role_metadata_json
           FROM device.virtual_device_binding b
          WHERE b.organization_id = $1
            AND b.source_device_list_id = $2
            AND b.source_component_key = $3
            AND b.effective_to IS NULL
            AND b.effective_from <= $4::timestamptz
            AND b.mode IN ('materialized', 'derived')`,
        [
            input.organizationId,
            input.sourceDeviceListId,
            input.sourceComponentKey,
            input.ts
        ]
    );
}

async function writeProjectedRow(
    input: ProjectSourceStatusSampleInput,
    binding: AffectedBindingRow,
    projection: VirtualRoleProjection,
    deps: ProjectionDeps
): Promise<'inserted' | 'duplicate'> {
    const inserted = await deps.queryRows<{ok: boolean}>(
        `WITH inserted_projection AS (
            INSERT INTO device.virtual_device_projected_sample (
                ts,
                organization_id,
                virtual_device_list_id,
                binding_id,
                role_key,
                series,
                field,
                value,
                prev_value,
                source_device_list_id,
                source_external_id,
                source_component_key,
                source_ts
            )
            VALUES (
                $2::timestamptz, $5, $1, $6, $7, $11, $12,
                $3::jsonb, $4::jsonb, $8, $9, $10, $2::timestamptz
            )
            ON CONFLICT ON CONSTRAINT virtual_device_projected_sample_idempotency
                DO NOTHING
            RETURNING TRUE AS ok
        ),
        inserted_sample AS (
            INSERT INTO device.virtual_device_sample_source (
                ts,
                organization_id,
                virtual_device_list_id,
                binding_id,
                role_key,
                source_device_list_id,
                source_external_id,
                source_component_key,
                source_ts
            )
            SELECT $2::timestamptz, $5, $1, $6, $7, $8, $9, $10, $2::timestamptz
              FROM inserted_projection
            ON CONFLICT (
                virtual_device_list_id,
                role_key,
                binding_id,
                source_ts
            )
                DO NOTHING
            RETURNING TRUE AS ok
        )
        SELECT COALESCE(
            (SELECT ok FROM inserted_sample),
            FALSE
        ) AS ok`,
        [
            binding.virtual_device_list_id,
            input.ts,
            jsonParameter(input.value),
            jsonParameter(input.prevValue ?? null),
            input.organizationId,
            binding.binding_id,
            binding.role_key,
            input.sourceDeviceListId,
            input.sourceExternalId,
            input.sourceComponentKey,
            projection.series,
            projection.field
        ]
    );
    return inserted[0]?.ok ? 'inserted' : 'duplicate';
}

function assertFieldSafe(field: string): void {
    if (!FIELD_PATTERN.test(field)) {
        throw RpcError.InvalidParams('invalid projection field', [
            {field: 'field', error: field, code: 'invalid_field'}
        ]);
    }
}

function jsonParameter(value: unknown): string {
    return JSON.stringify(value ?? null);
}

function bindingProjection(
    input: Pick<ProjectSourceStatusSampleInput, 'sourceComponentKey' | 'field'>,
    binding: AffectedBindingRow
): VirtualRoleProjection {
    return resolveRoleProjection({
        roleKey: binding.role_key,
        sourceComponentKey: input.sourceComponentKey,
        unit: binding.unit,
        valueType: binding.value_type,
        sourceSnapshot: binding.source_snapshot_json,
        roleMetadata: binding.role_metadata_json,
        transformJson: binding.transform_json
    });
}
