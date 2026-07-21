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
import CardValue_Battery from '@/components/cards/CardValue_Battery.vue';
import CardValue_BluRemote from '@/components/cards/CardValue_BluRemote.vue';
import CardValue_Button from '@/components/cards/CardValue_Button.vue';
import CardValue_Camera from '@/components/cards/CardValue_Camera.vue';
import CardValue_CB from '@/components/cards/CardValue_CB.vue';
import CardValue_Cover from '@/components/cards/CardValue_Cover.vue';
import CardValue_Cury from '@/components/cards/CardValue_Cury.vue';
import CardValue_Dimmer from '@/components/cards/CardValue_Dimmer.vue';
import CardValue_Door from '@/components/cards/CardValue_Door.vue';
import CardValue_Energy from '@/components/cards/CardValue_Energy.vue';
import CardValue_HVAC from '@/components/cards/CardValue_HVAC.vue';
import CardValue_Illuminance from '@/components/cards/CardValue_Illuminance.vue';
import CardValue_Info from '@/components/cards/CardValue_Info.vue';
import CardValue_Input from '@/components/cards/CardValue_Input.vue';
import CardValue_Presence from '@/components/cards/CardValue_Presence.vue';
import CardValue_RGBW from '@/components/cards/CardValue_RGBW.vue';
import CardValue_Rotation from '@/components/cards/CardValue_Rotation.vue';
import CardValue_Sensor from '@/components/cards/CardValue_Sensor.vue';
import CardValue_Service from '@/components/cards/CardValue_Service.vue';
import CardValue_Switch from '@/components/cards/CardValue_Switch.vue';
import CardValue_Temperature from '@/components/cards/CardValue_Temperature.vue';
import CardValue_TempHumidity from '@/components/cards/CardValue_TempHumidity.vue';
import CardValue_TRV from '@/components/cards/CardValue_TRV.vue';
import CardValue_Virtual from '@/components/cards/CardValue_Virtual.vue';
import CardValue_WallDisplay from '@/components/cards/CardValue_WallDisplay.vue';
import {useDevicesStore} from '@/stores/devices';

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

    // Circuit breaker (Pro CB)
    cb: {component: CardValue_CB},

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

    // Sensors (with variant). `temperature` is routed in resolveEntityCard
    // (temp-only vs temp+humidity depends on the device).
    humidity: {component: CardValue_Sensor, variant: 'humidity'},
    flood: {component: CardValue_Sensor, variant: 'flood'},
    smoke: {component: CardValue_Sensor, variant: 'smoke'},
    devicepower: {component: CardValue_Battery},
    illuminance: {component: CardValue_Illuminance},
    door: {component: CardValue_Door},
    window: {component: CardValue_Door},
    motion: {component: CardValue_Sensor, variant: 'motion'},
    // Occupancy (Wall Display presence sensor): reuses the motion style, the
    // same variant the BTHome occupancy sensor already uses. Reads status.value.
    occupancy: {component: CardValue_Sensor, variant: 'motion'},
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
 * BTHome sensors whose objName maps to a dedicated single-value card. Keyed by
 * the backend-sent objName so no device knowledge lives in the frontend.
 */
export const BTHOME_OBJNAME_CARDS: Record<string, Component> = {
    battery: CardValue_Battery,
    illuminance: CardValue_Illuminance,
    rotation: CardValue_Rotation,
    // BLU temperature is temp-only (BLU humidity is its own separate card).
    temperature: CardValue_Temperature,
    // Door/window family (all render open/closed state).
    door: CardValue_Door,
    window: CardValue_Door,
    opening: CardValue_Door,
    garage_door: CardValue_Door,
    lock: CardValue_Door
};

/**
 * A bthomedevice that exposes button/dimmer controls is a physical BLU remote.
 * Single source for that test, shared by the dashboard resolver and the
 * add-widget size-picker preview so the two never diverge.
 */
export function isBluRemoteEntity(entity?: {
    type?: string;
    properties?: Record<string, any>;
}): boolean {
    if (entity?.type !== 'bthomedevice') return false;
    const controls = entity.properties?.controls as
        | Array<{kind?: string}>
        | undefined;
    return (
        Array.isArray(controls) &&
        controls.some((c) => c.kind === 'button' || c.kind === 'dimmer')
    );
}

/**
 * Resolve an entity type to its card component + extra props.
 * Returns null if the type has no dedicated card component.
 * Accepts optional entity for device-specific overrides (e.g. Wall Display thermostat).
 */
export function resolveEntityCard(
    entityType: string,
    entity?: {properties?: Record<string, any>; source?: string}
): CardMapping | null {
    // BTHome sensors with a dedicated card, keyed by backend objName. Each is
    // its own single-value card (battery routes here too; devicepower battery
    // is handled by the type map below).
    if (entityType === 'bthomesensor') {
        const card = BTHOME_OBJNAME_CARDS[entity?.properties?.objName ?? ''];
        if (card) return {component: card};
    }
    // Native temperature: temp+humidity when the device also reports humidity
    // (humidity:0), otherwise temp-only. The decision follows the device.
    if (entityType === 'temperature') {
        const source = entity?.source;
        const hasHumidity = !!(
            source && useDevicesStore().devices[source]?.status?.['humidity:0']
        );
        return {
            component: hasHumidity
                ? CardValue_TempHumidity
                : CardValue_Temperature
        };
    }
    // Wall Display thermostat gets its own card
    if (
        entityType === 'thermostat' &&
        entity?.properties?.deviceType === 'walldisplay'
    ) {
        return {component: CardValue_WallDisplay};
    }
    // A BLU remote gets its own card; a controls-less bthomedevice (sensor hub)
    // falls through to the generic card.
    if (isBluRemoteEntity({type: entityType, properties: entity?.properties})) {
        return {component: CardValue_BluRemote};
    }
    // XT1 service entities: backend-resolved category picks the card.
    if (entityType === 'service') {
        if (entity?.properties?.category === 'hvac') {
            return {component: CardValue_HVAC};
        }
        return {component: CardValue_Service};
    }
    return ENTITY_CARD_MAP[entityType] ?? null;
}
