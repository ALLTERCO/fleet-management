// Target a BLU sensor for a component_state rule WITHOUT promoting it to a
// device. The backend uses "component:<id>" as a logical sensor target, then reads
// the backing bthomesensor value. So a rule can fire on a gateway's BLU
// door/window sensor with no promotion.

import {normalizeMac} from '@/helpers/bluCardDedup';
import type {bthomesensor_entity, entity_t} from '@/types/entities';

export interface EntityTarget {
    readonly entityId: string;
    /** The gateway (or device) the entity lives on. */
    readonly source: string;
    readonly label: string;
}

/** Answer: the BLU sensor entities that can be alerted on directly. A sensor
 *  already promoted to a first-class device is shown as that device row, so
 *  drop it here — matched by BLE MAC (SSOT with the devices-grid dedup). */
export function listBluSensorTargets(
    entities: readonly entity_t[],
    promotedMacs?: ReadonlySet<string>
): EntityTarget[] {
    return entities
        .filter((e) => e.type === 'bthomesensor')
        .filter((e) => !isPromoted(e as bthomesensor_entity, promotedMacs))
        .map((e) => ({
            entityId: e.id,
            source: e.source,
            label: e.name || e.id
        }));
}

function isPromoted(
    e: bthomesensor_entity,
    promotedMacs?: ReadonlySet<string>
): boolean {
    if (!promotedMacs?.size) return false;
    return promotedMacs.has(normalizeMac(e.properties?.addr));
}

/** Answer: the component_state config that fires when this BLU sensor's binary
 *  value equals `equals` (true = open/active). */
export function bluSensorStateConfig(
    entityId: string,
    equals: boolean
): Record<string, unknown> {
    return {component: `component:${entityId}`, field: 'value', equals};
}
