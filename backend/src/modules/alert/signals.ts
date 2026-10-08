/**
 * Unified signal view over a device: native status components + BLU
 * entities relayed through a BTHome gateway. Every evaluator sees the
 * same abstraction, so BLU sensors trigger alerts the same way their
 * wired counterparts do — scope matches, fingerprints attribute to the
 * right subject, and the alert page points at the actual device.
 */
import {
    bthomeObjectInfos,
    objIdsForName,
    resolveBluSensorOverride
} from '../../config/BTHomeData';
import type AbstractDevice from '../../model/AbstractDevice';
import type {bthomesensor_entity, entity_t} from '../../types';

export interface Signal {
    subjectType: 'device' | 'entity';
    /** shellyID for device-level signals, entity.id for entity-level. */
    subjectId: string;
    /** Human-facing display name, for alert title/message. */
    displayName: string;
    /** Which device this signal came from (gateway for BLU). */
    gatewayShellyID: string;
    /** Synthetic status object evaluators scan. */
    status: Record<string, unknown>;
}

// BTHome object-name → normalized field evaluators scan. Keys are lowercase;
// the lookup lowercases so display-cased names ('Flood') resolve too. Leak
// devices report either 'flood' (custom obj_name) or the catalog 'moisture'.
//
// CAREFUL with 'moisture': BTHome gives that one name to three different
// objects (config/BTHomeData.ts) — 0x20 is a Wet/Dry BINARY alarm, while 0x14
// and 0x2F are percentage READINGS (a soil probe). Only the binary one means
// water is present, so MEASURED_ONLY_OBJ_NAMES below refuses to raise a flood
// from a percentage. Without that guard a BLU Soil probe sitting in damp
// ground, and every other child of the same gateway, reported "Water
// detected".
const BLU_FIELD_BY_OBJ_NAME: Record<string, string> = {
    motion: 'motion',
    moving: 'motion',
    battery: 'percent',
    smoke: 'smoke',
    flood: 'flood',
    moisture: 'flood',
    temperature: 'tC',
    humidity: 'rh',
    pressure: 'pressure',
    co2: 'co2',
    tvoc: 'tvoc',
    illuminance: 'lux',
    presence: 'presence',
    occupancy: 'occupancy',
    tamper: 'tamper',
    vibration: 'vibration',
    carbon_monoxide: 'carbon_monoxide',
    gas: 'gas',
    garage_door: 'garage_door',
    lock: 'lock',
    sound: 'sound',
    window: 'open',
    door: 'open',
    opening: 'open'
};

function isBthomeSensor(e: entity_t): e is bthomesensor_entity {
    return e.type === 'bthomesensor';
}

/** Look up the live component status backing a bthomesensor entity. */
function bluSensorComponent(
    device: AbstractDevice,
    entity: bthomesensor_entity
): {value?: unknown} | undefined {
    const sensorId = entity.properties.id;
    const status = device.status as Record<string, unknown> | undefined;
    return status?.[`bthomesensor:${sensorId}`] as
        | {value?: unknown}
        | undefined;
}

/** Object names whose ALARM meaning belongs only to the binary form. A
 *  percentage carrying the same name is a measurement, never an alarm. */
const MEASURED_ONLY_OBJ_NAMES = new Set(['moisture']);

/** BTHome marks a Wet/Dry object as a binary_sensor and a percentage as a
 *  sensor (config/BTHomeData.ts). */
function isBinarySensor(entity: bthomesensor_entity): boolean {
    return String(entity.properties.sensorType ?? '') === 'binary_sensor';
}

/**
 * What this object means ON THIS MODEL, lowercased.
 *
 * A BTHome object id does not always mean the same thing on every device. The
 * Ecowitt WS90 sends the Wet/Dry moisture object (0x20) to report rain
 * (docs-ble/Devices/BLU_ZB/EcowittWS90WeatherStation.md, Packet Type 1), so a
 * shower outdoors raised a CRITICAL "water leak" on a weather station. The
 * per-model meanings already exist for the capture pipeline
 * (config/BTHomeData.ts BLU_SENSOR_OVERRIDES); alerts read the same table
 * rather than keeping a second opinion.
 */
export function modelObjName(
    entity: bthomesensor_entity,
    objName: string
): string {
    const generic = objName.toLowerCase();
    const model = entity.properties.bleModelId;
    if (!model) return generic;
    const sensorType = entity.properties.sensorType;
    for (const objId of objIdsForName(generic)) {
        // One name covers several objects (moisture is binary 0x20 plus two
        // percentages); only the one this entity actually is can speak for it.
        if (sensorType && bthomeObjectInfos[objId]?.type !== sensorType) {
            continue;
        }
        const override = resolveBluSensorOverride(model, objId, undefined);
        if (override) return override.kind.toLowerCase();
    }
    return generic;
}

function bluSignal(
    device: AbstractDevice,
    entity: bthomesensor_entity
): Signal | null {
    const objName = entity.properties.objName;
    if (!objName) return null;
    // A soil probe reads 38% moisture. That is not a leak.
    if (
        MEASURED_ONLY_OBJ_NAMES.has(objName.toLowerCase()) &&
        !isBinarySensor(entity)
    ) {
        return null;
    }
    // Normalize case: object names are lowercase, but a display-cased value
    // must still resolve rather than silently drop the signal.
    const field = BLU_FIELD_BY_OBJ_NAME[modelObjName(entity, objName)];
    if (!field) return null;
    const component = bluSensorComponent(device, entity);
    if (component?.value === undefined) return null;
    const bleName =
        entity.properties.bleDisplayName ?? entity.properties.bleProductName;
    return {
        subjectType: 'entity',
        subjectId: entity.id,
        displayName: bleName ?? entity.name ?? entity.id,
        gatewayShellyID: device.shellyID,
        status: {[field]: component.value}
    };
}

/**
 * The `bthomesensor:N` component keys on this device whose BTHome object is
 * `objName` (per-model meaning applied). A gateway exposes every BLU reading
 * under the same component type; only the object name says what it measures.
 */
export function bluComponentsForObject(
    device: Pick<AbstractDevice, 'entities'> | undefined,
    objName: string
): Set<string> {
    const wanted = objName.toLowerCase();
    const out = new Set<string>();
    for (const e of device?.entities ?? []) {
        if (!isBthomeSensor(e)) continue;
        const raw = e.properties?.objName;
        if (!raw || e.properties?.id === undefined) continue;
        if (modelObjName(e, raw) !== wanted) continue;
        out.add(`bthomesensor:${e.properties.id}`);
    }
    return out;
}

const WILDCARD = ':*';

/** The concrete components a component rule watches on this status: the
 *  literal one, or every instance of the type for a "switch:*" watch-all,
 *  narrowed to one BTHome object when `objName` is set. */
export function alertTargetComponents(
    target: {component: string; objName?: string},
    status: Record<string, unknown>,
    device: AbstractDevice | undefined,
    promotedAway?: ReadonlySet<string>
): string[] {
    // Splitting on ':' matches the component TYPE, so 'switch:*' never sweeps in 'switchx:0'.
    const candidates = target.component.endsWith(WILDCARD)
        ? Object.keys(status).filter(
              (k) =>
                  k.split(':')[0] ===
                  target.component.slice(0, -WILDCARD.length)
          )
        : [target.component];
    const owned = promotedAway
        ? candidates.filter((k) => !promotedAway.has(k))
        : candidates;
    if (target.objName === undefined) return owned;
    const bluComponents = bluComponentsForObject(device, target.objName);
    return owned.filter((k) => bluComponents.has(k));
}

/** The single component type a component rule watches, or null when it
 *  targets an entity id and so can read any component. */
export function componentRuleInputTypes(
    component: unknown
): ReadonlySet<string> | null {
    if (typeof component !== 'string' || !component) return null;
    if (component.startsWith('component:') || component.startsWith('entity:'))
        return null;
    return new Set([component.split(':')[0] ?? component]);
}

/** Every signal this device publishes: one per status component + BLU entities.
 *  `promotedAway` holds gateway components a promoted BLU device owns; those
 *  are judged on that BLU device, never again on the gateway. */
export function collectSignals(
    device: AbstractDevice,
    promotedAway?: ReadonlySet<string>
): Signal[] {
    const out: Signal[] = [];
    const status = (device.status ?? {}) as Record<string, unknown>;
    const displayName =
        (device.info?.name as string | undefined) ?? device.shellyID;

    // Native status components live under one device-scoped signal so
    // existing evaluators that scan all `motion:N` / `smoke:N` / etc.
    // keep working on a single merged view.
    out.push({
        subjectType: 'device',
        subjectId: device.shellyID,
        displayName,
        gatewayShellyID: device.shellyID,
        status
    });

    for (const entity of device.entities ?? []) {
        if (!isBthomeSensor(entity)) continue;
        if (promotedAway?.has(`bthomesensor:${entity.properties.id}`)) continue;
        const sig = bluSignal(device, entity);
        if (sig) out.push(sig);
    }
    return out;
}

/** Convenience: every entity id on the device (for scope matching). */
export function collectEntityIds(device: AbstractDevice): string[] {
    return (device.entities ?? []).map((e) => e.id);
}
