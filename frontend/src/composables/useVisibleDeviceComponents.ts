// Data layer for the widget data contract. Unions the visible cards' component
// needs per device into a deduped Map<deviceId, Set<component>>. That map drives
// the device.list projection (Phase 3) and the live subscription allow-list
// (Phase 2). Kept decoupled from the stores: callers pass the resolved visible
// entities, so this stays a pure, testable unit.

import {computed, type MaybeRefOrGetter, toValue} from 'vue';
import {
    componentsForEntity,
    type EntityLike
} from '@/config/cardComponentManifest';

/** Union the component needs of the given entities, per device. */
export function unionComponents(
    entities: readonly EntityLike[]
): Map<string, Set<string>> {
    const byDevice = new Map<string, Set<string>>();
    for (const entity of entities) {
        const {deviceId, components} = componentsForEntity(entity);
        if (!deviceId) continue;
        let set = byDevice.get(deviceId);
        if (!set) {
            set = new Set<string>();
            byDevice.set(deviceId, set);
        }
        for (const c of components) set.add(c);
    }
    return byDevice;
}

/** Flatten the per-device union into a single subscription descriptor:
 *  the on-screen device ids and the deduped set of component keys they show. */
export function unionToSub(map: Map<string, Set<string>>): {
    shellyIDs: string[];
    paths: string[];
} {
    const paths = new Set<string>();
    for (const set of map.values()) {
        for (const c of set) paths.add(c);
    }
    return {shellyIDs: [...map.keys()], paths: [...paths]};
}

/** Reactive view of the union over a live source of visible entities. */
export function useVisibleDeviceComponents(
    entities: MaybeRefOrGetter<readonly EntityLike[]>
) {
    return computed(() => unionComponents(toValue(entities)));
}
