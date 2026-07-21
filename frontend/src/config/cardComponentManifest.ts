// Card-type data contract: the device components a card type reads beyond the
// entity's own component. Per-component (Shelly speaks in components like
// switch:0, sys, bthomedevice:1), never per-field. The frontend data layer
// unions these across the visible cards to drive the list projection and the
// live subscription allow-list.

export const EXTRA_COMPONENTS: Record<string, readonly string[]> = {
    switch: ['sys'],
    cover: ['sys'],
    light: ['sys'],
    sensor: ['sys'],
    illuminance: ['sys']
};

export interface EntityLike {
    type: string;
    source: string;
    properties?: {id?: number};
}

// Resolve an entity to its device id and the component set its card needs:
// the entity's own component plus the manifest extras for its type.
export function componentsForEntity(entity: EntityLike): {
    deviceId: string;
    components: string[];
} {
    const own = `${entity.type}:${entity.properties?.id ?? 0}`;
    const extras = EXTRA_COMPONENTS[entity.type] ?? [];
    return {deviceId: entity.source, components: [own, ...extras]};
}
