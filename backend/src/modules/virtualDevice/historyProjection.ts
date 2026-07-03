// Project source status samples onto materialized/derived virtual roles.

import RpcError from '../../rpc/RpcError';
import * as postgres from '../PostgresProvider';

const FIELD_PATTERN = /^[a-zA-Z][\w:.-]*$/;

export type ProjectionTransform =
    | {kind: 'none'}
    | {kind: 'scale'; factor: number}
    | {kind: 'offset'; offset: number}
    | {kind: 'invert'}
    | {kind: 'enum_map'; mapping: Readonly<Record<string, string>>};

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
}

const defaultDeps: ProjectionDeps = {
    queryRows: postgres.queryRows
};
const SOURCE_TARGET_KEY_SEPARATOR = '\0';

// `{skip: true}` when validation fails — caller increments `skipped`.
export function applyTransform(
    value: unknown,
    transform: ProjectionTransform
): {value: unknown} | {skip: true} {
    switch (transform.kind) {
        case 'none':
            return {value};
        case 'scale':
            return numericTransform(
                value,
                (n) => n * transform.factor,
                transform.factor
            );
        case 'offset':
            return numericTransform(
                value,
                (n) => n + transform.offset,
                transform.offset
            );
        case 'invert':
            if (typeof value !== 'boolean') return {skip: true};
            return {value: !value};
        case 'enum_map': {
            if (typeof value !== 'string') return {skip: true};
            const mapped = transform.mapping[value];
            return mapped === undefined ? {skip: true} : {value: mapped};
        }
    }
}

// Unknown shapes collapse to `none` so we never execute untrusted ops.
export function parseTransform(raw: unknown): ProjectionTransform {
    if (!raw || typeof raw !== 'object') return {kind: 'none'};
    const obj = raw as Record<string, unknown>;
    switch (obj.kind) {
        case 'scale':
            return typeof obj.factor === 'number' && Number.isFinite(obj.factor)
                ? {kind: 'scale', factor: obj.factor}
                : {kind: 'none'};
        case 'offset':
            return typeof obj.offset === 'number' && Number.isFinite(obj.offset)
                ? {kind: 'offset', offset: obj.offset}
                : {kind: 'none'};
        case 'invert':
            return {kind: 'invert'};
        case 'enum_map': {
            const mapping = sanitizeEnumMapping(obj.mapping);
            return mapping ? {kind: 'enum_map', mapping} : {kind: 'none'};
        }
        default:
            return {kind: 'none'};
    }
}

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
        const transformed = applyTransform(
            input.value,
            parseTransform(binding.transform_json)
        );
        if ('skip' in transformed) {
            skipped++;
            continue;
        }
        if (!isValueValid(transformed.value, binding.value_type)) {
            skipped++;
            continue;
        }
        const result = await writeProjectedRow(
            {...input, value: transformed.value},
            binding,
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
}

export async function projectStatusBatch(
    entries: readonly ProjectionBatchEntry[],
    deps: ProjectionDeps = defaultDeps
): Promise<ProjectionResult> {
    const targets = collectTargets(entries);
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
                deps
            );
            projected += result.projected;
            skipped += result.skipped;
        }
    }
    return {projected, skipped};
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
    deps: ProjectionDeps
): Promise<ProjectionResult> {
    assertFieldSafe(input.field);
    const transformed = applyTransform(
        input.value,
        parseTransform(binding.transform_json)
    );
    if ('skip' in transformed) return {projected: 0, skipped: 1};
    if (!isValueValid(transformed.value, binding.value_type)) {
        return {projected: 0, skipped: 1};
    }
    const result = await writeProjectedRow(
        {...input, value: transformed.value},
        binding,
        deps
    );
    return result === 'inserted'
        ? {projected: 1, skipped: 0}
        : {projected: 0, skipped: 1};
}

function splitFieldKey(
    field: string
): {componentKey: string; field: string} | null {
    const dot = field.lastIndexOf('.');
    if (dot <= 0 || dot === field.length - 1) return null;
    const componentKey = field.slice(0, dot);
    if (!/^[a-z][a-z0-9_]*:\d+$/.test(componentKey)) return null;
    return {componentKey, field: field.slice(dot + 1)};
}

function numericTransform(
    value: unknown,
    op: (n: number) => number,
    operand: number
): {value: unknown} | {skip: true} {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return {skip: true};
    }
    if (!Number.isFinite(operand)) return {skip: true};
    const result = op(value);
    if (!Number.isFinite(result)) return {skip: true};
    return {value: result};
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
            b.value_type
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
    deps: ProjectionDeps
): Promise<'inserted' | 'duplicate'> {
    // Status insert is the gate so we never write a provenance sample that
    // points at a status row some earlier batch already owns.
    const inserted = await deps.queryRows<{ok: boolean}>(
        `WITH inserted_status AS (
            INSERT INTO device.status (id, ts, field, field_group, value, prev_value)
            SELECT $1, $2::timestamptz, $3, $4, $5, $6
             WHERE NOT EXISTS (
                SELECT 1 FROM device.status
                 WHERE id = $1 AND ts = $2::timestamptz AND field = $3
             )
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
            SELECT $2::timestamptz, $7, $1, $8, $9, $10, $11, $12, $2::timestamptz
              FROM inserted_status
            ON CONFLICT ON CONSTRAINT idx_virtual_device_sample_source_idempotency
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
            `${binding.role_key}.${input.field}`,
            binding.role_key,
            jsonValue(input.value),
            jsonValue(input.prevValue ?? null),
            input.organizationId,
            binding.binding_id,
            binding.role_key,
            input.sourceDeviceListId,
            input.sourceExternalId,
            input.sourceComponentKey
        ]
    );
    return inserted[0]?.ok ? 'inserted' : 'duplicate';
}

function sanitizeEnumMapping(raw: unknown): Record<string, string> | null {
    if (!raw || typeof raw !== 'object') return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string') return null;
        out[key] = value;
    }
    return out;
}

function assertFieldSafe(field: string): void {
    if (!FIELD_PATTERN.test(field)) {
        throw RpcError.InvalidParams('invalid projection field', [
            {field: 'field', error: field, code: 'invalid_field'}
        ]);
    }
}

function jsonValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value;
    return value;
}
