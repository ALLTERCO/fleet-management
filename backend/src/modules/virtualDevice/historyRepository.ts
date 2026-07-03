import RpcError from '../../rpc/RpcError';
import type {
    VirtualDeviceBindingSourceRef,
    VirtualDeviceHistoryMode,
    VirtualDeviceHistoryPointDto,
    VirtualDeviceHistoryReadProvenanceDto,
    VirtualDeviceHistoryReadProvenanceParams,
    VirtualDeviceHistoryReadRoleDto,
    VirtualDeviceHistoryReadRoleParams,
    VirtualDeviceHistorySampleProvenanceDto,
    VirtualDeviceHistorySegmentDto
} from '../../types/api/virtualdevice';
import * as postgres from '../PostgresProvider';

interface HistoryRepositoryDeps {
    queryRows<T = unknown>(
        sql: string,
        params?: readonly unknown[]
    ): Promise<Array<T>>;
}

interface VirtualDeviceRow {
    device_list_id: number;
}

interface BindingSegmentRow {
    id: string;
    role_key: string;
    source_device_list_id: number;
    source_external_id: string;
    source_component_key: string;
    source_dynamic_category: string | null;
    mode: VirtualDeviceHistoryMode;
    effective_from: Date | string;
    effective_to: Date | string | null;
}

interface StatusTimelineRow {
    ts: Date | string;
    value: number | string | null;
    prev_value: number | string | null;
}

interface SampleSourceRow {
    ts: Date | string;
    binding_id: string;
    role_key: string;
    source_external_id: string;
    source_component_key: string;
    source_ts: Date | string;
}

export interface VirtualDeviceSampleSourceInput {
    organizationId: string;
    virtualDeviceListId: number;
    bindingId: string;
    roleKey: string;
    ts: string;
    sourceDeviceListId: number | null;
    sourceExternalId: string;
    sourceComponentKey: string;
    sourceTs: string;
}

const DEFAULT_HISTORY_LIMIT = 10_000;
const FIELD_PATTERN = /^[a-zA-Z][\w:.-]*$/;

const defaultDeps: HistoryRepositoryDeps = {
    queryRows: postgres.queryRows
};

export async function readVirtualDeviceRoleHistory(
    organizationId: string,
    input: VirtualDeviceHistoryReadRoleParams,
    deps: HistoryRepositoryDeps = defaultDeps
): Promise<VirtualDeviceHistoryReadRoleDto> {
    const window = parseHistoryWindow(input);
    assertStatusField(input.field);
    const device = await getVirtualDevice(
        organizationId,
        input.externalId,
        deps
    );
    const segments = await listBindingSegments(
        organizationId,
        device.device_list_id,
        input.roleKey,
        window,
        deps
    );
    const items = await readSegmentPoints(
        organizationId,
        segments,
        input.field,
        input.limit ?? DEFAULT_HISTORY_LIMIT,
        deps
    );
    return {items, provenance: segments.map(segmentToDto)};
}

export async function readVirtualDeviceRoleProvenance(
    organizationId: string,
    input: VirtualDeviceHistoryReadProvenanceParams,
    deps: HistoryRepositoryDeps = defaultDeps
): Promise<VirtualDeviceHistoryReadProvenanceDto> {
    const window = parseHistoryWindow(input);
    const device = await getVirtualDevice(
        organizationId,
        input.externalId,
        deps
    );
    const segments = await listBindingSegments(
        organizationId,
        device.device_list_id,
        input.roleKey,
        window,
        deps
    );
    const samples = await listSampleSources(
        organizationId,
        device.device_list_id,
        input.roleKey,
        window,
        input.limit ?? DEFAULT_HISTORY_LIMIT,
        deps
    );
    return {segments: segments.map(segmentToDto), samples};
}

export async function recordVirtualDeviceSampleSource(
    input: VirtualDeviceSampleSourceInput,
    deps: HistoryRepositoryDeps = defaultDeps
): Promise<void> {
    await deps.queryRows(
        `INSERT INTO device.virtual_device_sample_source (
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            input.ts,
            input.organizationId,
            input.virtualDeviceListId,
            input.bindingId,
            input.roleKey,
            input.sourceDeviceListId,
            input.sourceExternalId,
            input.sourceComponentKey,
            input.sourceTs
        ]
    );
}

async function getVirtualDevice(
    organizationId: string,
    externalId: string,
    deps: HistoryRepositoryDeps
): Promise<VirtualDeviceRow> {
    const rows = await deps.queryRows<VirtualDeviceRow>(
        `SELECT vd.device_list_id
           FROM device.virtual_device vd
           JOIN device.list dl
             ON dl.id = vd.device_list_id
            AND dl.organization_id = vd.organization_id
          WHERE vd.organization_id = $1
            AND dl.external_id = $2
            AND vd.deleted_at IS NULL
          LIMIT 1`,
        [organizationId, externalId]
    );
    const row = rows[0];
    if (!row) throw RpcError.NotFound('virtual_device', externalId);
    return row;
}

async function listBindingSegments(
    organizationId: string,
    deviceListId: number,
    roleKey: string,
    window: HistoryWindow,
    deps: HistoryRepositoryDeps
): Promise<BindingSegment[]> {
    const rows = await deps.queryRows<BindingSegmentRow>(
        `SELECT
            b.id,
            b.role_key,
            b.source_device_list_id,
            dl.external_id AS source_external_id,
            b.source_component_key,
            b.source_dynamic_category,
            b.mode,
            b.effective_from,
            b.effective_to
           FROM device.virtual_device_binding b
           JOIN device.list dl
             ON dl.id = b.source_device_list_id
            AND dl.organization_id = b.organization_id
          WHERE b.organization_id = $1
            AND b.virtual_device_list_id = $2
            AND b.role_key = $3
            AND b.effective_from < $5::timestamptz
            AND COALESCE(b.effective_to, 'infinity'::timestamptz) > $4::timestamptz
          ORDER BY b.effective_from ASC, b.created_at ASC`,
        [organizationId, deviceListId, roleKey, window.fromIso, window.toIso]
    );
    return rows.map((row) => rowToSegment(row, deviceListId, window));
}

async function readSegmentPoints(
    organizationId: string,
    segments: readonly BindingSegment[],
    field: string,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<VirtualDeviceHistoryPointDto[]> {
    const points: VirtualDeviceHistoryPointDto[] = [];
    for (const segment of segments) {
        if (points.length >= limit) break;
        const remaining = limit - points.length;
        const rows = await readSegmentTimeline(
            organizationId,
            segment,
            field,
            remaining,
            deps
        );
        points.push(...rows.map((row) => rowToPoint(row, segment)));
    }
    return points.sort((a, b) => a.ts.localeCompare(b.ts));
}

async function readSegmentTimeline(
    organizationId: string,
    segment: BindingSegment,
    field: string,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<StatusTimelineRow[]> {
    if (segment.mode === 'live_only') return [];
    const rows = await deps.queryRows<StatusTimelineRow>(
        `SELECT ts, value, prev_value
           FROM device.fn_status_timeline($1, $2, $3, $4, $5)
          ORDER BY ts ASC
          LIMIT $6`,
        [
            organizationId,
            [historyDeviceListId(segment)],
            historyField(segment, field),
            segment.segmentFrom,
            segment.segmentTo,
            limit
        ]
    );
    return rows;
}

async function listSampleSources(
    organizationId: string,
    deviceListId: number,
    roleKey: string,
    window: HistoryWindow,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<VirtualDeviceHistorySampleProvenanceDto[]> {
    const rows = await deps.queryRows<SampleSourceRow>(
        `SELECT
            vss.ts,
            vss.binding_id,
            vss.role_key,
            vss.source_external_id,
            vss.source_component_key,
            vss.source_ts
           FROM device.virtual_device_sample_source vss
          WHERE vss.organization_id = $1
            AND vss.virtual_device_list_id = $2
            AND vss.role_key = $3
            AND vss.ts >= $4::timestamptz
            AND vss.ts <= $5::timestamptz
          ORDER BY vss.ts ASC
          LIMIT $6`,
        [
            organizationId,
            deviceListId,
            roleKey,
            window.fromIso,
            window.toIso,
            limit
        ]
    );
    return rows.map(rowToSampleSource);
}

function rowToSegment(
    row: BindingSegmentRow,
    virtualDeviceListId: number,
    window: HistoryWindow
): BindingSegment {
    const effectiveFrom = dateToIso(row.effective_from);
    const effectiveTo = nullableDateToIso(row.effective_to);
    return {
        bindingId: row.id,
        roleKey: row.role_key,
        virtualDeviceListId,
        sourceDeviceListId: row.source_device_list_id,
        source: {
            deviceExternalId: row.source_external_id,
            componentKey: row.source_component_key,
            ...(row.source_dynamic_category
                ? {dynamicCategory: row.source_dynamic_category as never}
                : {})
        },
        mode: row.mode,
        effectiveFrom,
        effectiveTo,
        segmentFrom: maxIso(effectiveFrom, window.fromIso),
        segmentTo: minIso(effectiveTo ?? window.toIso, window.toIso)
    };
}

function rowToPoint(
    row: StatusTimelineRow,
    segment: BindingSegment
): VirtualDeviceHistoryPointDto {
    return {
        ts: dateToIso(row.ts),
        value: row.value,
        prevValue: row.prev_value,
        bindingId: segment.bindingId,
        roleKey: segment.roleKey,
        mode: segment.mode,
        source: segment.source
    };
}

function rowToSampleSource(
    row: SampleSourceRow
): VirtualDeviceHistorySampleProvenanceDto {
    return {
        ts: dateToIso(row.ts),
        bindingId: row.binding_id,
        roleKey: row.role_key,
        source: {
            deviceExternalId: row.source_external_id,
            componentKey: row.source_component_key
        },
        sourceTs: dateToIso(row.source_ts)
    };
}

function segmentToDto(segment: BindingSegment): VirtualDeviceHistorySegmentDto {
    return {
        bindingId: segment.bindingId,
        roleKey: segment.roleKey,
        mode: segment.mode,
        source: segment.source,
        effectiveFrom: segment.effectiveFrom,
        effectiveTo: segment.effectiveTo,
        segmentFrom: segment.segmentFrom,
        segmentTo: segment.segmentTo
    };
}

function historyDeviceListId(segment: BindingSegment): number {
    return segment.mode === 'linked'
        ? segment.sourceDeviceListId
        : segment.virtualDeviceListId;
}

function historyField(segment: BindingSegment, field: string): string {
    return segment.mode === 'linked'
        ? `${segment.source.componentKey}.${field}`
        : `${segment.roleKey}.${field}`;
}

function parseHistoryWindow(input: {from: string; to: string}): HistoryWindow {
    const from = parseDate(input.from, 'from');
    const to = parseDate(input.to, 'to');
    if (from.getTime() >= to.getTime()) {
        throw RpcError.InvalidParams('from must be before to', [
            {field: 'from', error: input.from, code: 'invalid_range'},
            {field: 'to', error: input.to, code: 'invalid_range'}
        ]);
    }
    return {fromIso: from.toISOString(), toIso: to.toISOString()};
}

function parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
    throw RpcError.InvalidParams('invalid history date', [
        {field, error: value, code: 'invalid_date'}
    ]);
}

function assertStatusField(field: string): void {
    if (FIELD_PATTERN.test(field)) return;
    throw RpcError.InvalidParams('invalid history field', [
        {field: 'field', error: field, code: 'invalid_field'}
    ]);
}

function dateToIso(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}

function nullableDateToIso(value: Date | string | null): string | null {
    return value === null ? null : dateToIso(value);
}

function maxIso(left: string, right: string): string {
    return left >= right ? left : right;
}

function minIso(left: string, right: string): string {
    return left <= right ? left : right;
}

interface HistoryWindow {
    fromIso: string;
    toIso: string;
}

interface BindingSegment {
    bindingId: string;
    roleKey: string;
    virtualDeviceListId: number;
    sourceDeviceListId: number;
    source: VirtualDeviceBindingSourceRef;
    mode: VirtualDeviceHistoryMode;
    effectiveFrom: string;
    effectiveTo: string | null;
    segmentFrom: string;
    segmentTo: string;
}
