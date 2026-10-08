import type {AggregateBucket} from '../../model/analytics/bucketPick';
import * as postgres from '../PostgresProvider';
import {
    loadVirtualEnergySources,
    type VirtualEnergySource,
    virtualEnergyCounterValueKWh
} from './energySources';
import {readVirtualDeviceRoleHistory} from './historyRepository';

export interface ConsumptionWindowReading {
    consumptionKWh: number;
    sampleCount: number;
}

export interface VirtualConsumptionWindowDeps {
    resolveDeviceIds: typeof postgres.resolveDeviceIds;
    loadSources: typeof loadVirtualEnergySources;
    readRoleHistory: typeof readVirtualDeviceRoleHistory;
}

const defaultDeps: VirtualConsumptionWindowDeps = {
    resolveDeviceIds: postgres.resolveDeviceIds,
    loadSources: loadVirtualEnergySources,
    readRoleHistory: readVirtualDeviceRoleHistory
};

/**
 * Sum the imported-energy roles of each custom device over one alert window.
 * History.ReadRole follows every binding segment, so a physical replacement
 * remains one continuous logical window as long as the role key is retained.
 */
export async function readVirtualConsumptionWindowsKWh(
    organizationId: string,
    externalIds: readonly string[],
    from: Date,
    to: Date,
    bucket: AggregateBucket,
    deps: VirtualConsumptionWindowDeps = defaultDeps
): Promise<Map<string, ConsumptionWindowReading>> {
    const requested = [...new Set(externalIds.filter(isVirtualExternalId))];
    if (requested.length === 0) return new Map();
    const {internalIds, idMap} = await deps.resolveDeviceIds(requested);
    const virtualIds = internalIds.filter((id) =>
        isVirtualExternalId(idMap[id] ?? '')
    );
    if (virtualIds.length === 0) return new Map();

    const sources = await deps.loadSources(organizationId, virtualIds);
    const out = new Map<string, ConsumptionWindowReading>();
    for (const virtualId of virtualIds) {
        const externalId = idMap[virtualId];
        if (!externalId) continue;
        const seenSamples = new Set<string>();
        let consumptionKWh = 0;
        let sampleCount = 0;
        for (const source of uniqueImportedEnergyRoles(
            sources.get(virtualId) ?? []
        )) {
            const history = await deps.readRoleHistory(organizationId, {
                externalId,
                roleKey: source.roleKey,
                from: from.toISOString(),
                to: to.toISOString(),
                bucket,
                limit: 10_000
            });
            for (const point of history.items) {
                const lineage = [
                    point.source.deviceExternalId,
                    point.source.componentKey,
                    source.tag,
                    point.ts,
                    point.domain ?? '',
                    point.phase ?? ''
                ].join('|');
                if (seenSamples.has(lineage)) continue;
                const value = virtualEnergyCounterValueKWh(source, point.value);
                if (value === null) continue;
                seenSamples.add(lineage);
                consumptionKWh += value;
                sampleCount += point.sampleCount ?? 1;
            }
        }
        if (seenSamples.size > 0) {
            out.set(externalId, {consumptionKWh, sampleCount});
        }
    }
    return out;
}

function uniqueImportedEnergyRoles(
    sources: readonly VirtualEnergySource[]
): VirtualEnergySource[] {
    const out = new Map<string, VirtualEnergySource>();
    for (const source of sources) {
        if (source.tag !== 'total_act_energy') continue;
        // Repeated aliases of one component must not multiply consumption;
        // distinct components (including components on one device) do add up.
        const key = `${source.sourceDeviceListId}|${source.sourceComponentKey}|${source.tag}`;
        if (!out.has(key)) out.set(key, source);
    }
    return [...out.values()];
}

function isVirtualExternalId(externalId: string): boolean {
    return externalId.startsWith('vdev_');
}
