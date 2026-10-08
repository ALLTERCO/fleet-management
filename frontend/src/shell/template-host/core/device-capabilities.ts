import {componentActivePower} from '@api/componentPower';
import type {DeviceCapabilities, HostDeviceComponent} from './types';

const ENERGY_COMPONENTS = {
    em: /^em:\d+$/,
    emdata: /^emdata:\d+$/,
    em1: /^em1:\d+$/,
    em1data: /^em1data:\d+$/,
    pm1: /^pm1:\d+$/
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : null;
}

function readNumber(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
}

function readBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function add(value: number | null, next: number | null): number | null {
    if (next === null) return value;
    return (value ?? 0) + next;
}

/** A device with two alarm components is in alarm if either one is. */
function anyAlarm(value: boolean | null, next: unknown): boolean | null {
    const alarm = readBoolean(next);
    if (alarm === null) return value;
    return (value ?? false) || alarm;
}

function nestedNumber(
    source: Record<string, unknown>,
    key: string,
    child: string
): number | null {
    return readNumber(asRecord(source[key])?.[child]);
}

function bthomeType(
    device: Record<string, unknown>,
    componentKey: string,
    status: Record<string, unknown>
): string | null {
    const config = asRecord(device.config)?.[componentKey];
    const settings = asRecord(device.settings)?.[componentKey];
    const meta = asRecord(config) ?? asRecord(settings);
    const type = meta?.obj_id ?? meta?.type ?? status.kind;
    return typeof type === 'string' ? type : null;
}

function assignBthomeValue(
    values: CapabilityValues,
    type: string,
    status: Record<string, unknown>
): void {
    const numeric = readNumber(status.value);
    const bool = readBoolean(status.value);
    if (type === 'temperature' && numeric !== null) {
        values.temperatureC = numeric;
        return;
    }
    if (type === 'humidity' && numeric !== null) {
        values.humidityPct = numeric;
        return;
    }
    if (type === 'motion') {
        values.motionDetected = bool ?? (numeric !== null ? numeric > 0 : null);
        return;
    }
    // BTHome names the wet/dry binary `moisture`; Shelly's own wired sensor
    // calls the same reading `flood`.
    if (type === 'moisture' || type === 'flood') {
        values.leakDetected = bool ?? (numeric !== null ? numeric > 0 : null);
        return;
    }
    if (type === 'smoke') {
        values.smokeDetected = bool ?? (numeric !== null ? numeric > 0 : null);
        return;
    }
    if (['window', 'door', 'opening'].includes(type)) {
        values.doorOpen = bool ?? (numeric !== null ? numeric > 0 : null);
    }
}

interface CapabilityValues {
    energyPower: number | null;
    energyTotal: number | null;
    temperatureC: number | null;
    humidityPct: number | null;
    relayState: boolean | null;
    doorOpen: boolean | null;
    motionDetected: boolean | null;
    occupied: boolean | null;
    occupancyCount: number | null;
    leakDetected: boolean | null;
    smokeDetected: boolean | null;
}

function emptyValues(): CapabilityValues {
    return {
        energyPower: null,
        energyTotal: null,
        temperatureC: null,
        humidityPct: null,
        relayState: null,
        doorOpen: null,
        motionDetected: null,
        occupied: null,
        occupancyCount: null,
        leakDetected: null,
        smokeDetected: null
    };
}

function readEnergy(
    values: CapabilityValues,
    key: string,
    status: Record<string, unknown>
): boolean {
    if (ENERGY_COMPONENTS.em.test(key)) {
        values.energyPower = add(
            values.energyPower,
            componentActivePower(status)
        );
        return true;
    }
    if (ENERGY_COMPONENTS.emdata.test(key)) {
        values.energyTotal = add(
            values.energyTotal,
            readNumber(status.total_act) ?? readNumber(status.total_act_energy)
        );
        return true;
    }
    if (ENERGY_COMPONENTS.em1.test(key)) {
        values.energyPower = add(
            values.energyPower,
            componentActivePower(status)
        );
        return true;
    }
    if (ENERGY_COMPONENTS.em1data.test(key)) {
        values.energyTotal = add(
            values.energyTotal,
            readNumber(status.total_act_energy)
        );
        return true;
    }
    if (ENERGY_COMPONENTS.pm1.test(key)) {
        values.energyPower = add(
            values.energyPower,
            componentActivePower(status)
        );
        values.energyTotal = add(
            values.energyTotal,
            nestedNumber(status, 'aenergy', 'total')
        );
        return true;
    }
    return false;
}

function readSwitchLike(
    values: CapabilityValues,
    key: string,
    status: Record<string, unknown>
): boolean {
    if (/^switch:\d+$/.test(key)) {
        values.relayState = readBoolean(status.output);
        values.energyPower = add(
            values.energyPower,
            componentActivePower(status)
        );
        values.energyTotal = add(
            values.energyTotal,
            nestedNumber(status, 'aenergy', 'total')
        );
        return true;
    }
    if (/^cover:\d+$/.test(key)) {
        values.energyPower = add(
            values.energyPower,
            componentActivePower(status)
        );
        values.energyTotal = add(
            values.energyTotal,
            nestedNumber(status, 'aenergy', 'total')
        );
        values.relayState =
            typeof status.state === 'string'
                ? status.state === 'closed'
                : values.relayState;
        return true;
    }
    return false;
}

function readSensor(
    values: CapabilityValues,
    key: string,
    status: Record<string, unknown>
): boolean {
    if (/^temperature:\d+$/.test(key)) {
        values.temperatureC = readNumber(status.tC);
        return true;
    }
    if (/^humidity:\d+$/.test(key)) {
        values.humidityPct = readNumber(status.rh);
        return true;
    }
    // Wired alarm sensors report one boolean, `alarm`, per component.
    if (/^flood:\d+$/.test(key)) {
        values.leakDetected = anyAlarm(values.leakDetected, status.alarm);
        return true;
    }
    if (/^smoke:\d+$/.test(key)) {
        values.smokeDetected = anyAlarm(values.smokeDetected, status.alarm);
        return true;
    }
    if (/^presencezone:\d+$/.test(key)) {
        values.occupied =
            readBoolean(status.value) ?? readBoolean(status.state);
        values.occupancyCount = readNumber(status.num_objects);
        if (values.occupied === null && values.occupancyCount !== null) {
            values.occupied = values.occupancyCount > 0;
        }
        return true;
    }
    return false;
}

function readBthome(
    device: Record<string, unknown>,
    values: CapabilityValues,
    key: string,
    status: Record<string, unknown>
): void {
    if (!/^bthomesensor:\d+$/.test(key)) return;
    const type = bthomeType(device, key, status);
    if (type) assignBthomeValue(values, type, status);
}

function capabilitiesFromValues(values: CapabilityValues): DeviceCapabilities {
    const caps: DeviceCapabilities = {};
    if (values.energyPower !== null || values.energyTotal !== null) {
        caps.energy = {
            power_w: values.energyPower,
            total_energy_wh: values.energyTotal
        };
    }
    if (values.temperatureC !== null || values.humidityPct !== null) {
        caps.temperature = {
            temperature_c: values.temperatureC,
            humidity_pct: values.humidityPct
        };
    }
    if (values.relayState !== null) caps.relay = {state: values.relayState};
    if (values.doorOpen !== null) caps.door = {open: values.doorOpen};
    if (values.motionDetected !== null) {
        caps.motion = {detected: values.motionDetected};
    }
    if (values.occupied !== null) {
        caps.occupancy = {
            occupied: values.occupied,
            count: values.occupancyCount
        };
    }
    if (values.leakDetected !== null) {
        caps.leak = {detected: values.leakDetected};
    }
    if (values.smokeDetected !== null) {
        caps.smoke = {detected: values.smokeDetected};
    }
    return caps;
}

/** The key as the device writes it, split at the index separator. */
function toComponent(key: string): HostDeviceComponent {
    const separator = key.indexOf(':');
    return {
        type: separator > 0 ? key.slice(0, separator) : key,
        key
    };
}

export function deriveDomainCapabilities(
    rawDevice: unknown
): DeviceCapabilities {
    const device = asRecord(rawDevice);
    const status = asRecord(device?.status);
    if (!device || !status) return {};
    const values = emptyValues();
    const components: HostDeviceComponent[] = [];
    for (const [key, rawStatus] of Object.entries(status)) {
        const componentStatus = asRecord(rawStatus);
        if (!componentStatus) continue;
        components.push(toComponent(key));
        if (readEnergy(values, key, componentStatus)) continue;
        if (readSwitchLike(values, key, componentStatus)) continue;
        if (readSensor(values, key, componentStatus)) continue;
        readBthome(device, values, key, componentStatus);
    }
    return {...capabilitiesFromValues(values), components};
}
