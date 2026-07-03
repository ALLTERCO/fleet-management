import type {Component} from 'vue';
import {getEntityTemplate} from '@/config/entity-registry';

/**
 * Resolve the entity template component for a given entity type.
 * Returns undefined if no dedicated template exists (falls back to generic EntityWidget).
 */
export function resolveEntityTemplate(
    entityType: string
): Component | undefined {
    return getEntityTemplate(entityType);
}

// Re-export individual templates for direct imports
export {default as EntityTemplate_Cover} from './EntityTemplate_Cover.vue';
export {default as EntityTemplate_Cury} from './EntityTemplate_Cury.vue';
export {default as EntityTemplate_DaliLight} from './EntityTemplate_DaliLight.vue';
export {default as EntityTemplate_Illuminance} from './EntityTemplate_Illuminance.vue';
export {default as EntityTemplate_Light} from './EntityTemplate_Light.vue';
export {default as EntityTemplate_Matter} from './EntityTemplate_Matter.vue';
export {default as EntityTemplate_Media} from './EntityTemplate_Media.vue';
export {default as EntityTemplate_Meter} from './EntityTemplate_Meter.vue';
export {default as EntityTemplate_Sensor} from './EntityTemplate_Sensor.vue';
export {default as EntityTemplate_Service} from './EntityTemplate_Service.vue';
export {default as EntityTemplate_Switch} from './EntityTemplate_Switch.vue';
export {default as EntityTemplate_Thermostat} from './EntityTemplate_Thermostat.vue';
export {default as EntityTemplate_Ui} from './EntityTemplate_Ui.vue';
