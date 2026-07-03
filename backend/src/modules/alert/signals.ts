/**
 * Unified signal view over a device: native status components + BLU
 * entities relayed through a BTHome gateway. Every evaluator sees the
 * same abstraction, so BLU sensors trigger alerts the same way their
 * wired counterparts do — scope matches, fingerprints attribute to the
 * right subject, and the alert page points at the actual device.
 */
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

function bluSignal(
    device: AbstractDevice,
    entity: bthomesensor_entity
): Signal | null {
    const objName = entity.properties.objName;
    if (!objName) return null;
    // Normalize case: object names are lowercase, but a display-cased value
    // must still resolve rather than silently drop the signal.
    const field = BLU_FIELD_BY_OBJ_NAME[objName.toLowerCase()];
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

/** Every signal this device publishes: one per status component + BLU entities. */
export function collectSignals(device: AbstractDevice): Signal[] {
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
        const sig = bluSignal(device, entity);
        if (sig) out.push(sig);
    }
    return out;
}

/** Convenience: every entity id on the device (for scope matching). */
export function collectEntityIds(device: AbstractDevice): string[] {
    return (device.entities ?? []).map((e) => e.id);
}
