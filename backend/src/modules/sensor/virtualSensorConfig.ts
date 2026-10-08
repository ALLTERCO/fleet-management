// Reads what a Shelly X / XT1 device says about its own virtual components.
//
// A virtual component's meaning is not on the status wire, it is in the device
// config that Fleet Manager already holds:
//
//   config["number:201"] = {
//       _attrs: {owner: "service:0", role: "water_pressure"},
//       access: "cr"
//   }
//   config["service:0"] = {temp_unit: "C", pressure_unit: "PSI", ...}
//
// The unit sits on the owning service, not the component, because on XT1 it is
// an installer setting that applies to every reading of that quantity. So the
// component points at its owner and the owner states the unit.

import * as DeviceCollector from '../DeviceCollector';
import {isPlainObject} from '../util/isPlainObject';
import type {
    VirtualComponentConfig,
    VirtualConfigResolver
} from './virtualSensorCapture';

function readString(source: unknown, key: string): string | undefined {
    if (!isPlainObject(source)) return undefined;
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Reads one component's declared role, access and unit from a device config.
 * Exported separately from the DeviceCollector-backed resolver so it can be
 * tested against a config fixture with no device runtime.
 */
export function virtualComponentConfig(
    config: Record<string, unknown>,
    componentKey: string
): VirtualComponentConfig | undefined {
    const component = config[componentKey];
    if (!isPlainObject(component)) return undefined;
    const attrs = component._attrs;
    const role = readString(attrs, 'role');
    return {
        role,
        access: readString(component, 'access'),
        siblingRoles: declaredRoles(config)
    };
}

/**
 * Every role the device declares. A generic role such as `state` only becomes
 * meaningful next to its siblings: `state` on a device that also declares
 * `water_consumption` is a water valve, and the device said so itself.
 */
function declaredRoles(config: Record<string, unknown>): string[] {
    const roles: string[] = [];
    for (const component of Object.values(config)) {
        if (!isPlainObject(component)) continue;
        const role = readString(component._attrs, 'role');
        if (role) roles.push(role);
    }
    return roles;
}

/**
 * Resolver bound to the live device collection. Devices are keyed by shellyID
 * there, while a status batch carries the numeric device-list id, so the lookup
 * walks the collection once per batch rather than per row.
 */
export function deviceConfigResolver(
    deviceListIdToShellyId: ReadonlyMap<number, string>
): VirtualConfigResolver {
    return (deviceListId, componentKey) => {
        const shellyId = deviceListIdToShellyId.get(deviceListId);
        if (!shellyId) return undefined;
        const device = DeviceCollector.getDevice(shellyId);
        if (!device) return undefined;
        return virtualComponentConfig(
            device.config as Record<string, unknown>,
            componentKey
        );
    };
}
