import {componentActivePower} from '@api/componentPower';
import type {HostDevice} from './types';

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
}

function emptyValues(): CapabilityValues {
    return {
        energyPower: null,
        energyTotal: null,
        temperatureC: null,
        humidityPct: null,
        relayState: null,
        doorOpen: null,
        motionDetected: null
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

function capabilitiesFromValues(
    values: CapabilityValues
): HostDevice['capabilities'] {
    const caps: HostDevice['capabilities'] = {};
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
    return caps;
}

export function deriveDomainCapabilities(
    rawDevice: unknown
): HostDevice['capabilities'] {
    const device = asRecord(rawDevice);
    const status = asRecord(device?.status);
    if (!device || !status) return {};
    const values = emptyValues();
    for (const [key, rawStatus] of Object.entries(status)) {
        const componentStatus = asRecord(rawStatus);
        if (!componentStatus) continue;
        if (readEnergy(values, key, componentStatus)) continue;
        if (readSwitchLike(values, key, componentStatus)) continue;
        if (readSensor(values, key, componentStatus)) continue;
        readBthome(device, values, key, componentStatus);
    }
    return capabilitiesFromValues(values);
}
