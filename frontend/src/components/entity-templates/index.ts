import type {Component} from 'vue';
import EntityTemplate_Cover from './EntityTemplate_Cover.vue';
import EntityTemplate_Light from './EntityTemplate_Light.vue';
import EntityTemplate_Meter from './EntityTemplate_Meter.vue';
import EntityTemplate_Switch from './EntityTemplate_Switch.vue';

const TEMPLATE_MAP: Record<string, Component> = {
    // Energy meters (single-phase)
    pm1: EntityTemplate_Meter,
    em1: EntityTemplate_Meter,

    // Switches & relays
    switch: EntityTemplate_Switch,

    // Lights (all variants — capabilities auto-detected from status keys)
    light: EntityTemplate_Light,
    rgb: EntityTemplate_Light,
    rgbw: EntityTemplate_Light,
    cct: EntityTemplate_Light,
    rgbcct: EntityTemplate_Light,

    // Covers / rollers
    cover: EntityTemplate_Cover
};

/**
 * Resolve the entity template component for a given entity type.
 * Returns undefined if no dedicated template exists (falls back to generic EntityWidget).
 */
export function resolveEntityTemplate(entityType: string): Component | undefined {
    return TEMPLATE_MAP[entityType];
}

export {
    EntityTemplate_Cover,
    EntityTemplate_Light,
    EntityTemplate_Meter,
    EntityTemplate_Switch
};
