/** Production AttributeWindow repository — wraps the SQL function and the
 *  scope resolver. Pure plumbing; the handler owns the orchestration. */

import * as PostgresProvider from '../../modules/PostgresProvider';
import {resolveScopeShellyIDs} from '../../modules/scopeResolver';
import type {
    AttributeAggregation,
    AttributeMetric,
    Contributor
} from '../../types/api/analytics';
import type {AttributeWindowRepo} from './attributeWindowHandler';
import type {AggregateBucket} from './bucketPick';

const METRIC_TAGS: Readonly<Record<AttributeMetric, string[]>> = {
    consumption: ['total_act_energy'],
    power: ['power'],
    voltage: ['voltage'],
    temperature: ['temperature']
};

const METRIC_SCALE: Readonly<Record<AttributeMetric, number>> = {
    consumption: 1000,
    power: 1,
    voltage: 1,
    temperature: 1
};

interface AttributeRow {
    device: number;
    tag: string;
    agg_value: number | null;
    sample_count: number | null;
}

interface DeviceMeta {
    deviceId: number;
    shellyID: string;
    deviceName: string;
}

export function createAttributeWindowRepo(): AttributeWindowRepo {
    return {
        resolveScopeShellyIDs: async (input) => {
            if (input.explicitDevices && input.explicitDevices.length > 0) {
                return [...input.explicitDevices];
            }
            return resolveScopeShellyIDs(
                input.organizationId,
                input.scopeKind,
                input.scopeIdValue
            );
        },
        queryContributors: async (input) => queryContributors(input)
    };
}

async function queryContributors(input: {
    shellyIDs: string[];
    from: Date;
    to: Date;
    bucket: AggregateBucket;
    metric: AttributeMetric;
    aggregation: AttributeAggregation;
}): Promise<Contributor[]> {
    const {internalIds, idMap} = await PostgresProvider.resolveDeviceIds(
        input.shellyIDs
    );
    if (internalIds.length === 0) return [];

    const tags = METRIC_TAGS[input.metric];
    const scale = METRIC_SCALE[input.metric];

    const res = await PostgresProvider.callMethod(
        'device_em.fn_attribute_window',
        {
            p_devices: internalIds,
            p_from: input.from,
            p_to: input.to,
            p_tags: tags,
            p_aggregation: input.aggregation
        }
    );
    const rows = (res?.rows ?? []) as AttributeRow[];
    const metaById = await fetchDeviceMeta(internalIds, idMap);

    return rows
        .filter((r) => r.agg_value !== null)
        .map((r) => mapRowToContributor(r, scale, metaById));
}

async function fetchDeviceMeta(
    internalIds: number[],
    idMap: Record<number, string>
): Promise<Map<number, DeviceMeta>> {
    const out = seedMetaFromIdMap(internalIds, idMap);
    for (const row of await fetchNamesBestEffort(Object.values(idMap))) {
        const meta = out.get(row.id);
        if (meta) meta.deviceName = row.jdoc?.name ?? meta.shellyID;
    }
    return out;
}

function seedMetaFromIdMap(
    internalIds: number[],
    idMap: Record<number, string>
): Map<number, DeviceMeta> {
    const out = new Map<number, DeviceMeta>();
    for (const id of internalIds) {
        const shellyID = idMap[id] ?? String(id);
        out.set(id, {deviceId: id, shellyID, deviceName: shellyID});
    }
    return out;
}

interface NameRow {
    id: number;
    jdoc?: {name?: string};
}

// shellyID is the acceptable fallback when the name lookup fails.
async function fetchNamesBestEffort(shellyIDs: string[]): Promise<NameRow[]> {
    try {
        return await PostgresProvider.getBatch(shellyIDs);
    } catch {
        return [];
    }
}

function mapRowToContributor(
    row: AttributeRow,
    scale: number,
    metaById: Map<number, DeviceMeta>
): Contributor {
    const meta = metaById.get(row.device);
    const rawValue = row.agg_value ?? 0;
    const value = scale === 1 ? rawValue : rawValue / scale;
    return {
        deviceId: row.device,
        shellyID: meta?.shellyID ?? String(row.device),
        deviceName: meta?.deviceName ?? String(row.device),
        value: +value.toFixed(4),
        share: 0,
        sampleCount: row.sample_count ?? 0
    };
}
