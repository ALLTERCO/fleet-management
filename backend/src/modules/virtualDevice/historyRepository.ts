import {RAW_ONLY_BUCKETS, VALID_BUCKETS} from '../../config/energy';
import RpcError from '../../rpc/RpcError';
import {ENERGY_TABLE_TAGS_LIST} from '../../types/api/_energyTags';
import {ELECTRICAL_SOURCES, ENERGY_COMMODITIES} from '../../types/api/energy';
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
import {
    applyTransform,
    type ProjectionTransform,
    parseTransform
} from './projectionTransform';
import {
    resolveRoleProjection,
    type VirtualRoleProjection
} from './roleProjection';

export interface HistoryRepositoryDeps {
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
    transform_json: Record<string, unknown> | null;
    value_type: string | null;
    unit: string | null;
    source_snapshot_json: Record<string, unknown> | null;
    role_metadata_json: Record<string, unknown> | null;
    effective_from: Date | string;
    effective_to: Date | string | null;
}

interface StatusTimelineRow {
    ts: Date | string;
    value: number | string | null;
    prev_value: number | string | null;
    min_value?: number | string | null;
    max_value?: number | string | null;
    sample_count?: number | string | null;
    channel?: number | string | null;
    reading_source?: string | null;
    tag?: string | null;
    domain?: string | null;
    phase?: string | null;
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
const DEFAULT_HISTORY_BUCKET = '1 hour';
const FIELD_PATTERN = /^[a-zA-Z][\w:.-]*$/;
const SENSOR_KIND_PATTERN = /^[a-z][a-z0-9_]*$/;
const ENERGY_TAGS = new Set<string>(ENERGY_TABLE_TAGS_LIST);
const ENERGY_COMMODITY_SET = new Set<string>(ENERGY_COMMODITIES);
const ELECTRICAL_SOURCE_SET = new Set<string>(ELECTRICAL_SOURCES);

const defaultDeps: HistoryRepositoryDeps = {
    queryRows: postgres.queryRows
};

export interface VirtualDeviceSourceHistoryPoint
    extends VirtualDeviceHistoryPointDto {
    virtualDeviceListId: number;
    sourceDeviceListId: number;
    series: VirtualRoleProjection['series'];
    field: string;
}

export interface VirtualDeviceSourceHistoryPage {
    items: VirtualDeviceSourceHistoryPoint[];
    hasMore: boolean;
}

export async function readVirtualDeviceRoleHistory(
    organizationId: string,
    input: VirtualDeviceHistoryReadRoleParams,
    deps: HistoryRepositoryDeps = defaultDeps
): Promise<VirtualDeviceHistoryReadRoleDto> {
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
    const items = await readSegmentPoints(
        organizationId,
        segments,
        input,
        input.limit ?? DEFAULT_HISTORY_LIMIT,
        deps
    );
    return {items, provenance: segments.map(segmentToDto)};
}

/**
 * Read the retained source store behind a role, even when the role itself is
 * materialized. Backfill uses this path so all history-series selection,
 * transforms, replacement segments and value validation stay aligned with
 * History.ReadRole instead of growing a second set of store queries.
 */
export async function readVirtualDeviceRoleSourceHistoryPage(
    organizationId: string,
    input: VirtualDeviceHistoryReadRoleParams,
    page: {offset: number; limit: number; expectedField: string},
    deps: HistoryRepositoryDeps = defaultDeps
): Promise<VirtualDeviceSourceHistoryPage> {
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
    for (const segment of segments) {
        if (segment.projection.field !== page.expectedField) {
            throw RpcError.InvalidParams('field does not match the bound role');
        }
    }
    const requested = page.offset + page.limit + 1;
    const points = await readSegmentPoints(
        organizationId,
        segments,
        {
            ...input,
            field: undefined,
            series: undefined,
            bucket: '15 minutes',
            order: 'asc',
            limit: requested
        },
        requested,
        deps,
        true
    );
    const selected = points.slice(page.offset, page.offset + page.limit);
    const byBinding = new Map(
        segments.map((segment) => [segment.bindingId, segment] as const)
    );
    return {
        items: selected.map((point) => {
            const segment = byBinding.get(point.bindingId);
            if (!segment) {
                throw new Error(
                    `history point references unknown binding ${point.bindingId}`
                );
            }
            return {
                ...point,
                virtualDeviceListId: segment.virtualDeviceListId,
                sourceDeviceListId: segment.sourceDeviceListId,
                series: segment.projection.series,
                field: segment.projection.field
            };
        }),
        hasMore: points.length > page.offset + page.limit
    };
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
            b.transform_json,
            b.value_type,
            b.unit,
            b.source_snapshot_json,
            b.role_metadata_json,
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
    input: VirtualDeviceHistoryReadRoleParams,
    limit: number,
    deps: HistoryRepositoryDeps,
    sourceOnly = false
): Promise<VirtualDeviceHistoryPointDto[]> {
    const points: VirtualDeviceHistoryPointDto[] = [];
    const orderedSegments =
        input.order === 'desc' ? [...segments].reverse() : segments;
    for (const segment of orderedSegments) {
        if (points.length >= limit) break;
        const remaining = limit - points.length;
        const rows = await readSegmentTimeline(
            organizationId,
            segment,
            input,
            remaining,
            deps,
            sourceOnly
        );
        for (const row of rows) {
            const point = rowToPoint(row, segment);
            const transformed = transformHistoryPoint(
                point,
                sourceOnly || segment.mode === 'linked'
                    ? segment.projection.transform
                    : null
            );
            if (
                transformed &&
                (!sourceOnly ||
                    isProjectedValueValid(transformed.value, segment.valueType))
            ) {
                points.push(transformed);
            }
        }
    }
    return points.sort((a, b) =>
        input.order === 'desc'
            ? b.ts.localeCompare(a.ts)
            : a.ts.localeCompare(b.ts)
    );
}

async function readSegmentTimeline(
    organizationId: string,
    segment: BindingSegment,
    input: VirtualDeviceHistoryReadRoleParams,
    limit: number,
    deps: HistoryRepositoryDeps,
    sourceOnly = false
): Promise<StatusTimelineRow[]> {
    if (segment.mode === 'live_only') return [];
    assertRequestedProjection(input, segment);
    const legacyStatusField =
        !segment.projectionPersisted &&
        input.series === undefined &&
        input.field !== undefined
            ? input.field
            : undefined;
    const resolvedInput: ResolvedHistoryInput = {
        ...input,
        field: legacyStatusField ?? segment.projection.field,
        series: legacyStatusField ? 'status' : segment.projection.series,
        sensorSource: (segment.projection.sensorSource ??
            input.sensorSource) as never,
        commodity: (segment.projection.commodity ?? input.commodity) as never,
        electricalSource: (segment.projection.electricalSource ??
            input.electricalSource) as never,
        // The role owns exactly its bound component channel. A caller cannot
        // use a readable virtual role to inspect a sibling source channel.
        channel: undefined
    };
    if (
        !sourceOnly &&
        (segment.mode === 'materialized' || segment.mode === 'derived')
    ) {
        return readProjectedTimeline(
            organizationId,
            segment,
            resolvedInput,
            limit,
            deps
        );
    }
    const timelineSegment =
        sourceOnly &&
        (segment.mode === 'materialized' || segment.mode === 'derived')
            ? {...segment, mode: 'linked' as const}
            : segment;
    switch (resolvedInput.series) {
        case 'status':
            return readStatusTimeline(
                organizationId,
                timelineSegment,
                resolvedInput.field,
                limit,
                deps,
                historyOrder(resolvedInput)
            );
        case 'sensor_numeric':
            return readSensorNumericTimeline(
                organizationId,
                timelineSegment,
                resolvedInput,
                limit,
                deps
            );
        case 'sensor_event':
            return readSensorEventTimeline(
                organizationId,
                timelineSegment,
                resolvedInput,
                limit,
                deps
            );
        case 'energy':
            return readEnergyTimeline(
                organizationId,
                timelineSegment,
                resolvedInput,
                limit,
                deps
            );
    }
}

async function readProjectedTimeline(
    organizationId: string,
    segment: BindingSegment,
    input: ResolvedHistoryInput,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<StatusTimelineRow[]> {
    const order = historyOrder(input);
    const commonParams = [
        organizationId,
        segment.virtualDeviceListId,
        segment.bindingId,
        input.series,
        input.field,
        segment.segmentFrom,
        segment.segmentTo,
        limit
    ];
    if (input.series === 'status' || input.series === 'sensor_event') {
        return deps.queryRows<StatusTimelineRow>(
            `SELECT
                sample.ts,
                sample.value,
                sample.prev_value,
                $9::smallint AS channel,
                $10::varchar AS reading_source
               FROM device.virtual_device_projected_sample sample
              WHERE sample.organization_id = $1
                AND sample.virtual_device_list_id = $2
                AND sample.binding_id = $3
                AND sample.series = $4
                AND sample.field = $5
                AND sample.ts >= $6::timestamptz
                AND sample.ts < $7::timestamptz
              ORDER BY sample.ts ${order}
              LIMIT $8`,
            [
                ...commonParams,
                historyChannel(segment, undefined),
                input.sensorSource ?? null
            ]
        );
    }

    const bucket = input.bucket ?? DEFAULT_HISTORY_BUCKET;
    if (input.series === 'sensor_numeric') {
        return deps.queryRows<StatusTimelineRow>(
            `SELECT
                time_bucket($9::interval, sample.ts) AS ts,
                AVG((sample.value #>> '{}')::double precision) AS value,
                NULL AS prev_value,
                MIN((sample.value #>> '{}')::double precision) AS min_value,
                MAX((sample.value #>> '{}')::double precision) AS max_value,
                COUNT(*)::bigint AS sample_count,
                $10::smallint AS channel,
                $11::varchar AS reading_source
               FROM device.virtual_device_projected_sample sample
              WHERE sample.organization_id = $1
                AND sample.virtual_device_list_id = $2
                AND sample.binding_id = $3
                AND sample.series = $4
                AND sample.field = $5
                AND sample.ts >= $6::timestamptz
                AND sample.ts < $7::timestamptz
                AND jsonb_typeof(sample.value) = 'number'
              GROUP BY 1
              ORDER BY 1 ${order}
              LIMIT $8`,
            [
                ...commonParams,
                bucket,
                historyChannel(segment, undefined),
                input.sensorSource ?? null
            ]
        );
    }

    const isCounter =
        input.field === 'total_act_energy' ||
        input.field === 'total_act_ret_energy';
    return deps.queryRows<StatusTimelineRow>(
        `WITH numeric_samples AS (
            SELECT
                sample.ts,
                (sample.value #>> '{}')::double precision AS value,
                CASE
                    WHEN jsonb_typeof(sample.prev_value) = 'number'
                    THEN (sample.prev_value #>> '{}')::double precision
                    ELSE NULL
                END AS prev_value
              FROM device.virtual_device_projected_sample sample
             WHERE sample.organization_id = $1
               AND sample.virtual_device_list_id = $2
               AND sample.binding_id = $3
               AND sample.series = $4
               AND sample.field = $5
               AND sample.ts >= $6::timestamptz
               AND sample.ts < $7::timestamptz
               AND jsonb_typeof(sample.value) = 'number'
        ), values_to_aggregate AS (
            SELECT
                ts,
                CASE
                    WHEN $10::boolean
                    THEN CASE WHEN value > prev_value THEN value - prev_value END
                    ELSE value
                END AS value
              FROM numeric_samples
        )
        SELECT
            time_bucket($9::interval, ts) AS ts,
            CASE WHEN $10::boolean THEN SUM(value) ELSE AVG(value) END AS value,
            NULL AS prev_value,
            MIN(value) AS min_value,
            MAX(value) AS max_value,
            COUNT(value)::bigint AS sample_count,
            $11::smallint AS channel,
            $5::varchar AS tag,
            'custom_device'::varchar AS domain
          FROM values_to_aggregate
         WHERE value IS NOT NULL
         GROUP BY 1
         ORDER BY 1 ${order}
         LIMIT $8`,
        [...commonParams, bucket, isCounter, historyChannel(segment, undefined)]
    );
}

async function readStatusTimeline(
    organizationId: string,
    segment: BindingSegment,
    field: string,
    limit: number,
    deps: HistoryRepositoryDeps,
    order: 'ASC' | 'DESC'
): Promise<StatusTimelineRow[]> {
    const rows = await deps.queryRows<StatusTimelineRow>(
        `SELECT ts, value, prev_value
           FROM device.fn_status_timeline($1, $2, $3, $4, $5)
          ORDER BY ts ${order}
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

async function readSensorNumericTimeline(
    organizationId: string,
    segment: BindingSegment,
    input: ResolvedHistoryInput,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<StatusTimelineRow[]> {
    const order = historyOrder(input);
    return deps.queryRows<StatusTimelineRow>(
        `SELECT
            h.bucket AS ts,
            h.avg_value::double precision AS value,
            NULL AS prev_value,
            h.min_value::double precision AS min_value,
            h.max_value::double precision AS max_value,
            h.sample_count,
            h.channel,
            h.source AS reading_source
           FROM device_sensor.fn_numeric_history(
                $1, $2, $3, $4, $5, $6, $7::interval, NULL
           ) h
          WHERE ($8::smallint IS NULL OR h.channel IS NOT DISTINCT FROM $8::smallint)
          ORDER BY h.bucket ${order}, h.source ASC, h.channel ASC NULLS FIRST
          LIMIT $9`,
        [
            organizationId,
            [historyDeviceListId(segment)],
            input.field,
            input.sensorSource ?? null,
            segment.segmentFrom,
            segment.segmentTo,
            input.bucket ?? DEFAULT_HISTORY_BUCKET,
            historyChannel(segment, input.channel),
            limit
        ]
    );
}

async function readSensorEventTimeline(
    organizationId: string,
    segment: BindingSegment,
    input: ResolvedHistoryInput,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<StatusTimelineRow[]> {
    const order = historyOrder(input);
    return deps.queryRows<StatusTimelineRow>(
        `WITH matching_events AS (
            SELECT e.ts, e.state, e.channel, e.source
              FROM device_sensor.fn_events_query(
                    $1, $2, $3, $4, $5, NULL
              ) e
             WHERE ($6::smallint IS NULL OR e.channel IS NOT DISTINCT FROM $6::smallint)
               AND ($7::varchar IS NULL OR e.source = $7::varchar)
        )
        SELECT
            e.ts,
            e.state AS value,
            LAG(e.state) OVER (ORDER BY e.ts ASC) AS prev_value,
            e.channel,
            e.source AS reading_source
          FROM matching_events e
         ORDER BY e.ts ${order}
         LIMIT $8`,
        [
            organizationId,
            [historyDeviceListId(segment)],
            input.field,
            segment.segmentFrom,
            segment.segmentTo,
            historyChannel(segment, input.channel),
            input.sensorSource ?? null,
            limit
        ]
    );
}

async function readEnergyTimeline(
    organizationId: string,
    segment: BindingSegment,
    input: ResolvedHistoryInput,
    limit: number,
    deps: HistoryRepositoryDeps
): Promise<StatusTimelineRow[]> {
    const order = historyOrder(input);
    const bucket = input.bucket ?? DEFAULT_HISTORY_BUCKET;
    const params = [
        historyDeviceListId(segment),
        organizationId,
        input.field,
        segment.segmentFrom,
        segment.segmentTo,
        bucket,
        historyChannel(segment, input.channel),
        input.commodity ?? null,
        input.electricalSource ?? null,
        limit
    ];
    if (RAW_ONLY_BUCKETS.has(bucket)) {
        return deps.queryRows<StatusTimelineRow>(
            `SELECT
                time_bucket($6::interval, s.ts) AS ts,
                CASE device_em.fn_stats_tag_aggregation(s.tag)
                    WHEN 'sum' THEN SUM(s.val)::double precision
                    WHEN 'min' THEN MIN(s.val)::double precision
                    WHEN 'max' THEN MAX(s.val)::double precision
                    ELSE AVG(s.val)::double precision
                END AS value,
                NULL AS prev_value,
                MIN(s.val)::double precision AS min_value,
                MAX(s.val)::double precision AS max_value,
                COUNT(*)::bigint AS sample_count,
                s.channel,
                s.phase,
                s.tag,
                s.domain
               FROM device_em.fn_stats_readings(
                        ARRAY[$1::int], $4::timestamptz, $5::timestamptz,
                        ARRAY[$3::varchar(30)], FALSE) s
               JOIN device.list dl ON dl.id = s.device
              WHERE dl.organization_id = $2
                AND ($7::smallint IS NULL OR s.channel IS NOT DISTINCT FROM $7::smallint)
                AND ($8::text IS NULL OR s.commodity = $8::text)
                AND ($9::text IS NULL OR s.electrical_source IS NOT DISTINCT FROM $9::text)
              GROUP BY 1, s.channel, s.phase, s.tag, s.domain
              ORDER BY 1 ${order}, s.domain ASC
              LIMIT $10`,
            params
        );
    }
    return deps.queryRows<StatusTimelineRow>(
        `SELECT
            time_bucket($6::interval, s.bucket) AS ts,
            CASE device_em.fn_stats_tag_aggregation(s.tag)
                WHEN 'sum' THEN SUM(s.sum_val)::double precision
                WHEN 'min' THEN MIN(s.min_val)::double precision
                WHEN 'max' THEN MAX(s.max_val)::double precision
                ELSE (SUM(s.sum_val) / NULLIF(SUM(s.sample_count), 0))::double precision
            END AS value,
            NULL AS prev_value,
            MIN(s.min_val)::double precision AS min_value,
            MAX(s.max_val)::double precision AS max_value,
            SUM(s.sample_count)::bigint AS sample_count,
            s.channel,
            s.phase,
            s.tag,
            s.domain
           FROM device_em.energy_15min s
           JOIN device.list dl ON dl.id = s.device
          WHERE s.device = $1
            AND dl.organization_id = $2
            AND s.tag = $3
            AND s.bucket >= $4::timestamptz
            AND s.bucket < $5::timestamptz
            AND ($7::smallint IS NULL OR s.channel IS NOT DISTINCT FROM $7::smallint)
            AND ($8::text IS NULL OR s.commodity = $8::text)
            AND ($9::text IS NULL OR s.electrical_source IS NOT DISTINCT FROM $9::text)
          GROUP BY 1, s.channel, s.phase, s.tag, s.domain
          ORDER BY 1 ${order}, s.domain ASC
          LIMIT $10`,
        params
    );
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
        transformJson: row.transform_json,
        valueType: row.value_type,
        unit: row.unit,
        sourceSnapshot: row.source_snapshot_json,
        roleMetadata: row.role_metadata_json,
        effectiveFrom,
        effectiveTo,
        segmentFrom: maxIso(effectiveFrom, window.fromIso),
        segmentTo: minIso(effectiveTo ?? window.toIso, window.toIso),
        projection: resolveRoleProjection({
            roleKey: row.role_key,
            sourceComponentKey: row.source_component_key,
            mode: row.mode,
            unit: row.unit,
            valueType: row.value_type,
            sourceSnapshot: row.source_snapshot_json,
            roleMetadata: row.role_metadata_json,
            transformJson: row.transform_json
        }),
        projectionPersisted: hasPersistedProjection(row.role_metadata_json)
    };
}

function rowToPoint(
    row: StatusTimelineRow,
    segment: BindingSegment
): VirtualDeviceHistoryPointDto {
    const min = finiteNumber(row.min_value);
    const max = finiteNumber(row.max_value);
    const sampleCount = finiteNumber(row.sample_count);
    const channel = finiteNumber(row.channel);
    return {
        ts: dateToIso(row.ts),
        value: historyValue(row.value),
        prevValue: historyValue(row.prev_value),
        ...(row.min_value !== undefined ? {min} : {}),
        ...(row.max_value !== undefined ? {max} : {}),
        ...(sampleCount !== null
            ? {sampleCount: Math.max(0, Math.trunc(sampleCount))}
            : {}),
        ...(row.channel !== undefined ? {channel} : {}),
        ...(row.reading_source ? {readingSource: row.reading_source} : {}),
        ...(row.tag ? {tag: row.tag} : {}),
        ...(row.domain ? {domain: row.domain} : {}),
        ...(row.phase ? {phase: row.phase} : {}),
        bindingId: segment.bindingId,
        roleKey: segment.roleKey,
        mode: segment.mode,
        source: segment.source
    };
}

function transformHistoryPoint(
    point: VirtualDeviceHistoryPointDto,
    rawTransform: ProjectionTransform | Record<string, unknown> | null
): VirtualDeviceHistoryPointDto | null {
    const transform = parseTransform(rawTransform);
    const value = applyTransform(point.value, transform);
    if ('skip' in value) return null;
    const prevValue =
        point.prevValue === null
            ? {value: null}
            : applyTransform(point.prevValue, transform);
    if ('skip' in prevValue) return null;

    const transformedMin = transformOptionalNumber(point.min, transform);
    const transformedMax = transformOptionalNumber(point.max, transform);
    const numericBounds = [transformedMin, transformedMax].filter(
        (v): v is number => typeof v === 'number'
    );
    return {
        ...point,
        value: historyValue(value.value),
        prevValue: historyValue(prevValue.value),
        ...(point.min !== undefined
            ? {min: numericBounds.length ? Math.min(...numericBounds) : null}
            : {}),
        ...(point.max !== undefined
            ? {max: numericBounds.length ? Math.max(...numericBounds) : null}
            : {})
    };
}

function transformOptionalNumber(
    value: number | null | undefined,
    transform: ReturnType<typeof parseTransform>
): number | null {
    if (value === null || value === undefined) return null;
    const transformed = applyTransform(value, transform);
    if ('skip' in transformed) return null;
    return finiteNumber(transformed.value);
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

function historyChannel(
    segment: BindingSegment,
    requested: number | undefined
): number | null {
    if (requested !== undefined) return requested;
    const separator = segment.source.componentKey.lastIndexOf(':');
    if (separator < 0) return null;
    const channel = Number.parseInt(
        segment.source.componentKey.slice(separator + 1),
        10
    );
    return Number.isInteger(channel) && channel >= 0 ? channel : null;
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

function historyOrder(input: {order?: 'asc' | 'desc'}): 'ASC' | 'DESC' {
    return input.order === 'desc' ? 'DESC' : 'ASC';
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

function assertHistorySeriesInput(
    input: VirtualDeviceHistoryReadRoleParams
): void {
    if (input.field !== undefined) assertStatusField(input.field);
    const series = input.series ?? 'status';
    if (
        input.field !== undefined &&
        (series === 'sensor_numeric' || series === 'sensor_event') &&
        (!SENSOR_KIND_PATTERN.test(input.field) || input.field.length > 24)
    ) {
        throw RpcError.InvalidParams('invalid sensor history kind', [
            {field: 'field', error: input.field, code: 'invalid_sensor_kind'}
        ]);
    }
    if (
        input.field !== undefined &&
        series === 'energy' &&
        !ENERGY_TAGS.has(input.field)
    ) {
        throw RpcError.InvalidParams('invalid energy history tag', [
            {field: 'field', error: input.field, code: 'invalid_energy_tag'}
        ]);
    }
    if (input.bucket && !VALID_BUCKETS.has(input.bucket)) {
        throw RpcError.InvalidParams('invalid history bucket', [
            {field: 'bucket', error: input.bucket, code: 'invalid_bucket'}
        ]);
    }
    if (input.commodity && !ENERGY_COMMODITY_SET.has(input.commodity)) {
        throw RpcError.InvalidParams('invalid energy commodity', [
            {
                field: 'commodity',
                error: input.commodity,
                code: 'invalid_commodity'
            }
        ]);
    }
    if (
        input.electricalSource &&
        !ELECTRICAL_SOURCE_SET.has(input.electricalSource)
    ) {
        throw RpcError.InvalidParams('invalid electrical source', [
            {
                field: 'electricalSource',
                error: input.electricalSource,
                code: 'invalid_electrical_source'
            }
        ]);
    }
}

function assertRequestedProjection(
    input: VirtualDeviceHistoryReadRoleParams,
    segment: BindingSegment
): void {
    const projection = segment.projection;
    assertHistorySeriesInput(input);
    if (input.series !== undefined && input.series !== projection.series) {
        throw RpcError.InvalidParams('series does not match the bound role');
    }
    if (input.field !== undefined && input.field !== projection.field) {
        if (!(input.series === undefined && !segment.projectionPersisted)) {
            throw RpcError.InvalidParams('field does not match the bound role');
        }
    }
    if (
        input.channel !== undefined &&
        input.channel !== historyChannel(segment, undefined)
    ) {
        throw RpcError.InvalidParams('channel does not match the bound role');
    }
}

function hasPersistedProjection(
    metadata: Record<string, unknown> | null
): boolean {
    const projection = metadata?.projection;
    return (
        !!projection &&
        typeof projection === 'object' &&
        !Array.isArray(projection)
    );
}

function finiteNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? number : null;
}

function historyValue(value: unknown): number | string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value;
    return String(value);
}

function isProjectedValueValid(
    value: unknown,
    valueType: string | null
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
        default:
            return false;
    }
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

type ResolvedHistoryInput = Omit<
    VirtualDeviceHistoryReadRoleParams,
    'field' | 'series'
> & {
    field: string;
    series: VirtualRoleProjection['series'];
};

interface BindingSegment {
    bindingId: string;
    roleKey: string;
    virtualDeviceListId: number;
    sourceDeviceListId: number;
    source: VirtualDeviceBindingSourceRef;
    mode: VirtualDeviceHistoryMode;
    transformJson: Record<string, unknown> | null;
    valueType: string | null;
    unit: string | null;
    sourceSnapshot: Record<string, unknown> | null;
    roleMetadata: Record<string, unknown> | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    segmentFrom: string;
    segmentTo: string;
    projection: VirtualRoleProjection;
    projectionPersisted: boolean;
}
