// Energy.ListMeasurementPoints — list the wireable measurement points for a
// device or scope, for device Energy assignment. Primary source is the
// stored device_em history (the points that can actually query energy); the
// live snapshot adds the componentKey label and the "available now" flag.
// assignedMeterId (from the org's logical meters) marks already-wired points.

import {statsTagAggregation} from '../../modules/energyTagAggregation';
import type {
    EnergyRepository,
    MeasurementPointHistoryRow
} from '../../modules/repositories/EnergyRepository';
import {
    loadVirtualEnergySources,
    type VirtualEnergySource
} from '../../modules/virtualDevice/energySources';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyListMeasurementPointsParams,
    EnergyListMeasurementPointsResponse,
    EnergyLogicalMeter,
    EnergyMeasurementPoint
} from '../../types/api/energy';
import {
    deviceMeasurementPoints,
    type HistoryPoint,
    type MeasurementPointSource,
    mergeMeasurementPoints
} from './measurementPoints';
import {meterPointKey} from './meterOwnership';
import {resolveScope, type SenderCapabilities} from './queryHandler';

// Resolve a device's cached snapshot (status + config) by shellyID.
// DeviceCollector in production; a fake map in tests.
export type SnapshotLookup = (
    shellyID: string
) => MeasurementPointSource | undefined;

export interface ListMeasurementPointsDeps {
    lookup: SnapshotLookup;
    listMeters: (org: string) => Promise<EnergyLogicalMeter[]>;
    loadVirtualSources?: typeof loadVirtualEnergySources;
}

export async function handleListMeasurementPoints(
    validated: EnergyListMeasurementPointsParams,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    deps: ListMeasurementPointsDeps
): Promise<EnergyListMeasurementPointsResponse> {
    const selector = scopeSelector(validated);
    const org = sender.getOrganizationId();
    if (!org) throw RpcError.Unauthorized();

    const {internalIds, idMap} = await resolveScope(sender, selector, repo);
    if (internalIds.length === 0) return {points: []};

    const virtualIds = internalIds.filter((id) =>
        idMap[id]?.startsWith('vdev_')
    );
    const virtualSources = virtualIds.length
        ? await (deps.loadVirtualSources ?? loadVirtualEnergySources)(
              org,
              virtualIds
          )
        : new Map<number, VirtualEnergySource[]>();
    const sourceIds = [
        ...new Set([
            ...internalIds,
            ...[...virtualSources.values()]
                .flat()
                .map((source) => source.sourceDeviceListId)
        ])
    ];
    const history = groupHistoryByDevice(
        await repo.listMeasurementPointHistory(sourceIds)
    );
    const assignments = buildAssignments(await deps.listMeters(org));

    const includeAssigned = validated.includeAssigned ?? true;
    const points = new Map<string, EnergyMeasurementPoint>();
    for (const internalId of internalIds) {
        const linked = virtualSources.get(internalId);
        if (linked?.length) {
            for (const source of linked) {
                for (const point of linkedSourcePoints(
                    source,
                    history,
                    deps,
                    assignments
                )) {
                    if (!includeAssigned && point.assignedMeterId !== undefined)
                        continue;
                    points.set(measurementPointIdentity(point), point);
                }
            }
            continue;
        }
        const shellyID = idMap[internalId];
        const snapshot = deps.lookup(shellyID);
        const merged = mergeMeasurementPoints({
            deviceId: internalId,
            shellyID,
            history: history.get(internalId) ?? [],
            live: snapshot ? deviceMeasurementPoints(snapshot) : [],
            assignments
        });
        for (const p of merged) {
            if (!includeAssigned && p.assignedMeterId !== undefined) continue;
            points.set(measurementPointIdentity(p), p);
        }
    }
    return {points: [...points.values()]};
}

function linkedSourcePoints(
    source: VirtualEnergySource,
    history: Map<number, HistoryPoint[]>,
    deps: ListMeasurementPointsDeps,
    assignments: ReadonlyMap<string, number>
): EnergyMeasurementPoint[] {
    const sourceHistory = (history.get(source.sourceDeviceListId) ?? []).filter(
        (point) => point.channel === source.channel && point.tag === source.tag
    );
    const snapshot = deps.lookup(source.sourceExternalId);
    const live = snapshot
        ? deviceMeasurementPoints(snapshot).filter(
              (point) =>
                  point.channel === source.channel && point.tag === source.tag
          )
        : [];
    return mergeMeasurementPoints({
        // Logical meters intentionally own the canonical physical point. The
        // stable device.list id survives a hardware external-id replacement.
        deviceId: source.sourceDeviceListId,
        shellyID: source.sourceExternalId,
        history: sourceHistory,
        live,
        assignments
    });
}

function measurementPointIdentity(point: EnergyMeasurementPoint): string {
    return `${point.deviceId}|${point.channel}|${point.phase}|${point.tag}|${point.electricalDomain}`;
}

// shellyID and scope are mutually exclusive; exactly one is required.
function scopeSelector(
    p: EnergyListMeasurementPointsParams
): {scope?: never; devices?: string[]} | {scope: NonNullable<typeof p.scope>} {
    const hasShelly = p.shellyID !== undefined;
    const hasScope = p.scope !== undefined;
    if (hasShelly === hasScope) {
        throw RpcError.InvalidParams(
            'exactly one of shellyID or scope is required'
        );
    }
    return hasShelly ? {devices: [p.shellyID as string]} : {scope: p.scope};
}

function groupHistoryByDevice(
    rows: readonly MeasurementPointHistoryRow[]
): Map<number, HistoryPoint[]> {
    const byDevice = new Map<number, HistoryPoint[]>();
    for (const r of rows) {
        const list = byDevice.get(r.device) ?? [];
        list.push(toHistoryPoint(r));
        byDevice.set(r.device, list);
    }
    return byDevice;
}

// Energy tags store per-bucket energy, so the latest bucket sum is the sample;
// instantaneous tags store sum+count, so the sample is their average.
function toHistoryPoint(r: MeasurementPointHistoryRow): HistoryPoint {
    const isEnergy = statsTagAggregation(r.tag) === 'sum';
    const sampleValue =
        isEnergy || r.sample_count <= 0
            ? r.sum_val
            : r.sum_val / r.sample_count;
    return {
        channel: r.channel,
        phase: r.phase as HistoryPoint['phase'],
        tag: r.tag as HistoryPoint['tag'],
        electricalDomain: r.domain as HistoryPoint['electricalDomain'],
        sampleValue,
        sampleTs: r.sample_ts
    };
}

// (device, channel, tag) → owning meter id, the shared ownership grain. Keying
// by channel (not phase) matches SaveLogicalMeter: a meter owns the whole
// phase-summed channel, so every phase of it reads assigned.
function buildAssignments(
    meters: readonly EnergyLogicalMeter[]
): Map<string, number> {
    const byPoint = new Map<string, number>();
    for (const m of meters) {
        for (const p of m.points) {
            byPoint.set(meterPointKey(p.deviceId, p.channel, p.tag), m.id);
        }
    }
    return byPoint;
}
