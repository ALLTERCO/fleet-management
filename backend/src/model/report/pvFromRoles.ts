// Derive PV grid + generation meters from logical-meter roles, the SSOT that
// replaces the dashboard-JSON pv_grid_refs/pv_generation_refs. role=grid is the
// grid meter; role=pv and role=generator are generation. Points are mapped to
// (shellyID, channel) refs, scoped to the report's devices and de-duplicated
// (a 3-phase meter's a/b/c points share one channel). Pure — no DB.

import type {EnergyLogicalMeter, EnergyMeterRole} from '../../types/api/energy';
import type {PvMeterRef} from './pvEnergy';

const GENERATION_ROLES: ReadonlySet<EnergyMeterRole> = new Set([
    'pv',
    'generator'
]);

export interface PvRoleRefs {
    gridRefs: PvMeterRef[];
    generationRefs: PvMeterRef[];
}

export function pvRefsFromMeters(
    meters: readonly EnergyLogicalMeter[],
    deviceMap: ReadonlyMap<number, string>
): PvRoleRefs {
    const grid = new Map<string, PvMeterRef>();
    const generation = new Map<string, PvMeterRef>();
    for (const meter of meters) {
        const sink = sinkForRole(meter.role, grid, generation);
        if (!sink) continue;
        for (const point of meter.points) {
            const shellyID = deviceMap.get(point.deviceId);
            if (shellyID === undefined) continue;
            const ref: PvMeterRef = {device: shellyID, channel: point.channel};
            sink.set(`${shellyID}|${point.channel}`, ref);
        }
    }
    return {
        gridRefs: [...grid.values()],
        generationRefs: [...generation.values()]
    };
}

function sinkForRole(
    role: EnergyMeterRole,
    grid: Map<string, PvMeterRef>,
    generation: Map<string, PvMeterRef>
): Map<string, PvMeterRef> | null {
    if (role === 'grid') return grid;
    if (GENERATION_ROLES.has(role)) return generation;
    return null;
}
