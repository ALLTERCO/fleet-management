/**
 * Entity Card Resolver — maps entity types to CardValue_ components.
 *
 * This is the centralized registry for dashboard card rendering.
 * Adding a new entity type = one entry here. No template changes needed.
 *
 * Future direction: Replace the monolithic CardValue_ components with
 * composed primitives (CardShell + EntityControl_{type}).
 * For now, this resolver eliminates the v-if/v-else-if chain in the dashboard.
 */
import type {Component} from 'vue';
import CardValue_Audio from '@/components/cards/CardValue_Audio.vue';
import CardValue_Button from '@/components/cards/CardValue_Button.vue';
import CardValue_Camera from '@/components/cards/CardValue_Camera.vue';
import CardValue_Cover from '@/components/cards/CardValue_Cover.vue';
import CardValue_Cury from '@/components/cards/CardValue_Cury.vue';
import CardValue_Dimmer from '@/components/cards/CardValue_Dimmer.vue';
import CardValue_Energy from '@/components/cards/CardValue_Energy.vue';
import CardValue_HVAC from '@/components/cards/CardValue_HVAC.vue';
import CardValue_Info from '@/components/cards/CardValue_Info.vue';
import CardValue_Input from '@/components/cards/CardValue_Input.vue';
import CardValue_Presence from '@/components/cards/CardValue_Presence.vue';
import CardValue_RGBW from '@/components/cards/CardValue_RGBW.vue';
import CardValue_Sensor from '@/components/cards/CardValue_Sensor.vue';
import CardValue_Service from '@/components/cards/CardValue_Service.vue';
import CardValue_Switch from '@/components/cards/CardValue_Switch.vue';
import CardValue_TRV from '@/components/cards/CardValue_TRV.vue';
import CardValue_Virtual from '@/components/cards/CardValue_Virtual.vue';
import CardValue_WallDisplay from '@/components/cards/CardValue_WallDisplay.vue';

export interface CardMapping {
    component: Component;
    /** Sensor variant prop */
    variant?: string;
}

/**
 * Entity type → CardValue component mapping.
 * One line per type. Sensor types include their variant.
 */
export const ENTITY_CARD_MAP: Record<string, CardMapping> = {
    // Switches & relays
    switch: {component: CardValue_Switch},

    // Dimmers
    light: {component: CardValue_Dimmer},
    dimmer: {component: CardValue_Dimmer},

    // Covers
    cover: {component: CardValue_Cover},
    roller: {component: CardValue_Cover},

    // Energy meters
    em: {component: CardValue_Energy},
    em1: {component: CardValue_Energy},
    pm1: {component: CardValue_Energy},

    // Sensors (with variant)
    temperature: {component: CardValue_Sensor, variant: 'temp'},
    humidity: {component: CardValue_Sensor, variant: 'humidity'},
    flood: {component: CardValue_Sensor, variant: 'flood'},
    smoke: {component: CardValue_Sensor, variant: 'smoke'},
    devicepower: {component: CardValue_Sensor, variant: 'battery'},
    illuminance: {component: CardValue_Sensor, variant: 'illuminance'},
    door: {component: CardValue_Sensor, variant: 'door'},
    window: {component: CardValue_Sensor, variant: 'door'},
    motion: {component: CardValue_Sensor, variant: 'motion'},
    voltmeter: {component: CardValue_Sensor, variant: 'voltage'},

    // Smart bulbs
    rgb: {component: CardValue_RGBW},
    rgbw: {component: CardValue_RGBW},
    cct: {component: CardValue_RGBW},
    rgbcct: {component: CardValue_RGBW},

    // TRV / thermostat
    thermostat: {component: CardValue_TRV},
    blutrv: {component: CardValue_TRV},

    // Camera
    camera: {component: CardValue_Camera},

    // Media / Audio
    media: {component: CardValue_Audio},

    // Buttons
    button: {component: CardValue_Button},
    virtualbutton: {component: CardValue_Button},

    // Input
    input: {component: CardValue_Input},

    // Presence
    presencezone: {component: CardValue_Presence},
    presence: {component: CardValue_Presence},

    // Cury (scent diffuser)
    cury: {component: CardValue_Cury},

    // BTHome (resolved by bthomeVariant in dashboard)
    bthomesensor: {component: CardValue_Sensor},
    bthomedevice: {component: CardValue_Info},
    bthomecontrol: {component: CardValue_Info},

    // BLU Gateway
    blugw: {component: CardValue_Info},

    // Schedule
    schedule: {component: CardValue_Info},

    // XT1 service devices (HVAC, water valve, EV charger, etc.)
    // Generic card handles all types; HVAC gets dedicated card via resolveEntityCard override
    service: {component: CardValue_Service},

    // Matter
    matter: {component: CardValue_Info},

    // Camera zones (motion detection)
    camerazone: {component: CardValue_Sensor, variant: 'motion'},

    // Virtual components
    boolean: {component: CardValue_Virtual},
    number: {component: CardValue_Virtual},
    text: {component: CardValue_Virtual},
    enum: {component: CardValue_Virtual},
    group: {component: CardValue_Info}
};

/**
 * Resolve an entity type to its card component + extra props.
 * Returns null if the type has no dedicated card component.
 * Accepts optional entity for device-specific overrides (e.g. Wall Display thermostat).
 */
export function resolveEntityCard(
    entityType: string,
    entity?: {properties?: Record<string, any>}
): CardMapping | null {
    // Wall Display thermostat gets its own card
    if (
        entityType === 'thermostat' &&
        entity?.properties?.deviceType === 'walldisplay'
    ) {
        return {component: CardValue_WallDisplay};
    }
    // XT1 service entities: HVAC services get dedicated card, rest use generic
    if (entityType === 'service') {
        const svcType = entity?.properties?.serviceType ?? '';
        if (/hvac|thermostat|heating|heat/i.test(svcType)) {
            return {component: CardValue_HVAC};
        }
        return {component: CardValue_Service};
    }
    return ENTITY_CARD_MAP[entityType] ?? null;
}
