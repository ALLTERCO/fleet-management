// Backend-owned eligibility: can a device host a rule kind, judged from the
// same entity view the device UI renders. Profile/mode-aware for free — the
// entity view is regenerated on a profile change, so eligibility follows it.
import {bthomeObjectInfos} from '../../config/BTHomeData';
import type AbstractDevice from '../../model/AbstractDevice';
import type {bthomesensor_entity} from '../../types';
import type {AlertRuleKind} from '../../types/api/alert';
import type {BluetoothSourceComponentDto} from '../../types/api/virtualdevice';

export interface DeviceCapabilityView {
    /** entity.type values present (switch, temperature, em, smoke, …). */
    entityTypes: ReadonlySet<string>;
    /** entity.id values present — backs component:<id> targeting for BLU. */
    entityIds: ReadonlySet<string>;
    /** live status component instances (switch:0, em:0, bthomesensor:1, …). */
    componentKeys: ReadonlySet<string>;
    /** device-driven battery flag from the profile. */
    isBattery: boolean;
    /** BTHome object names on BLU sensors (motion, door, window, …). */
    bthomeObjNames?: ReadonlySet<string>;
}

// Availability / operation-outcome kinds — meaningful on any device.
const UNIVERSAL_KINDS: ReadonlySet<AlertRuleKind> = new Set([
    'device_offline',
    'device_back_online',
    'heartbeat',
    'energy_consumption_threshold',
    'cost_budget_threshold',
    'record_incomplete',
    'approaching_new_peak',
    'firmware_operation_failed',
    'backup_operation_failed',
    'automation_run_failed',
    'grafana_alert',
    'composite',
    'credential_expiring',
    'system_health'
]);

// Kinds satisfied by a specific capability on the device.
const ENTITY_REQUIREMENT: Partial<
    Record<AlertRuleKind, (v: DeviceCapabilityView) => boolean>
> = {
    battery_below: (v) => v.isBattery || v.entityTypes.has('devicepower'),
    smoke_alarm: (v) => v.entityTypes.has('smoke'),
    flood_alarm: (v) => v.entityTypes.has('flood'),
    motion_detected: (v) =>
        v.entityTypes.has('presence') ||
        (v.bthomeObjNames?.has('motion') ?? false)
};

// Kinds whose eligibility is the watched component existing on the device.
const CONFIG_DRIVEN_KINDS: ReadonlySet<AlertRuleKind> = new Set([
    'component_threshold',
    'component_state',
    'rate_of_change',
    'stuck_sensor',
    'change_event',
    'device_event',
    'anomaly_band'
]);

const COMPONENT_PREFIX = 'component:';
const LEGACY_ENTITY_PREFIX = 'entity:';

function configComponentPresent(
    view: DeviceCapabilityView,
    config: Record<string, unknown>
): boolean {
    const component = config.component;
    if (typeof component !== 'string' || !component) return true;
    const targetPrefix = component.startsWith(COMPONENT_PREFIX)
        ? COMPONENT_PREFIX
        : component.startsWith(LEGACY_ENTITY_PREFIX)
          ? LEGACY_ENTITY_PREFIX
          : null;
    if (targetPrefix) {
        return view.entityIds.has(component.slice(targetPrefix.length));
    }
    if (view.componentKeys.has(component)) return true;
    return view.entityTypes.has(component.split(':')[0] ?? '');
}

/** Can this device host this rule kind, given what it reports? */
export function deviceSupportsKind(
    view: DeviceCapabilityView,
    kind: AlertRuleKind,
    config: Record<string, unknown>
): boolean {
    if (UNIVERSAL_KINDS.has(kind)) return true;
    const requirement = ENTITY_REQUIREMENT[kind];
    if (requirement) return requirement(view);
    if (CONFIG_DRIVEN_KINDS.has(kind)) {
        return configComponentPresent(view, config);
    }
    return true;
}

/**
 * Capability view for a promoted BLU device.
 *
 * A promoted BLU device is its own row in the device list but has no live
 * connection of its own — it reports through a gateway, so its status is the
 * gateway's projection keyed by the same component keys. Without this view the
 * eligibility check has nothing to answer with and the device silently drops
 * out of every rule scope, even though the condition picker offers its paths.
 */
export function bluetoothCapabilityView(input: {
    components: readonly BluetoothSourceComponentDto[];
    status: Record<string, unknown>;
}): DeviceCapabilityView {
    const entityTypes = new Set<string>();
    const bthomeObjNames = new Set<string>();
    for (const component of input.components) {
        if (component.role === 'identity') continue;
        entityTypes.add(componentTypeOf(component.componentKey));
        const objName = bthomeObjectName(component.objectId);
        if (objName) bthomeObjNames.add(objName);
    }
    return {
        entityTypes,
        entityIds: new Set<string>(),
        componentKeys: new Set(Object.keys(input.status)),
        isBattery: hasBatteryReading(input.status),
        bthomeObjNames
    };
}

function componentTypeOf(componentKey: string): string {
    return componentKey.split(':')[0] ?? componentKey;
}

function bthomeObjectName(objectId: number | null): string | undefined {
    if (objectId == null) return undefined;
    return bthomeObjectInfos[objectId]?.name?.toLowerCase();
}

function hasBatteryReading(status: Record<string, unknown>): boolean {
    const identity = status.bluetoothdevice;
    return (
        !!identity &&
        typeof identity === 'object' &&
        'battery' in (identity as Record<string, unknown>)
    );
}

/** Extract the capability view from a live device — the only coupled part. */
export function capabilityViewOf(device: AbstractDevice): DeviceCapabilityView {
    const entityTypes = new Set<string>();
    const entityIds = new Set<string>();
    const bthomeObjNames = new Set<string>();
    for (const e of device.entities) {
        entityTypes.add(e.type);
        entityIds.add(e.id);
        if (e.type === 'bthomesensor') {
            const obj = (e as bthomesensor_entity).properties.objName;
            if (obj) bthomeObjNames.add(obj);
        }
    }
    const status = device.status as Record<string, unknown> | undefined;
    return {
        entityTypes,
        entityIds,
        componentKeys: new Set(status ? Object.keys(status) : []),
        isBattery: device.profile.flags.isBattery,
        bthomeObjNames
    };
}
