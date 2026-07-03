// "What does the device offer vs. what we render?" — pure helpers, IO in the route.

import type AbstractDevice from '../model/AbstractDevice';
import type {DeviceTribe} from '../model/deviceProfile';
import {UNKNOWN_COMPONENT_TYPE_COUNTER} from './coverageConstants';
import {composerRegistryKeys} from './EntityComposer';

export interface ComponentRow {
    type: string;
    deviceCount: number;
    instanceCount: number;
    hasComposer: boolean;
    hasEventHandler: boolean;
}

export type TribeBreakdown = Record<DeviceTribe['kind'] | 'unknown', number>;

export interface CoverageReport {
    totalDevices: number;
    profiledDevices: number;
    tribes: TribeBreakdown;
    components: ComponentRow[];
    unknownTypes: string[];
}

export {UNKNOWN_COMPONENT_TYPE_COUNTER};

interface Accumulator {
    deviceCount: number;
    instanceCount: number;
    hasEventHandler: boolean;
}

export function deviceComponentInstances(
    status: Record<string, unknown>
): Map<string, number> {
    const counts = new Map<string, number>();
    for (const key in status) {
        const value = status[key];
        if (!isComponentValue(value)) continue;
        const type = typeOfKey(key);
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
}

function isComponentValue(v: unknown): boolean {
    return typeof v === 'object' && v !== null;
}

function typeOfKey(key: string): string {
    const colon = key.indexOf(':');
    return colon === -1 ? key : key.slice(0, colon);
}

export function eventComponentTypes(device: AbstractDevice): Set<string> {
    const catalog = device.eventCatalog;
    if (!catalog) return new Set();
    const types = new Set<string>();
    for (const d of catalog.all) {
        if (typeof d.component === 'string' && d.component.length > 0) {
            types.add(d.component);
        }
    }
    return types;
}

const TRIBE_KINDS = [
    'shelly_native',
    'xmod',
    'xt1'
] as const satisfies readonly DeviceTribe['kind'][];

function isTribeKind(value: string): value is DeviceTribe['kind'] {
    return (TRIBE_KINDS as readonly string[]).includes(value);
}

function tribeKey(device: AbstractDevice): keyof TribeBreakdown {
    const tribe = device.profile?.tribe.kind;
    return tribe && isTribeKind(tribe) ? tribe : 'unknown';
}

function emptyTribes(): TribeBreakdown {
    const out = {unknown: 0} as TribeBreakdown;
    for (const kind of TRIBE_KINDS) out[kind] = 0;
    return out;
}

interface CoverageAccumulators {
    components: Map<string, Accumulator>;
    tribes: TribeBreakdown;
    profiledDevices: number;
}

function emptyAccumulators(): CoverageAccumulators {
    return {
        components: new Map(),
        tribes: emptyTribes(),
        profiledDevices: 0
    };
}

function accumulateAll(devices: AbstractDevice[]): CoverageAccumulators {
    const acc = emptyAccumulators();
    for (const device of devices) {
        acc.tribes[tribeKey(device)]++;
        if (device.profile) acc.profiledDevices++;
        recordOneDevice({device, components: acc.components});
    }
    return acc;
}

interface RecordOneInput {
    device: AbstractDevice;
    components: Map<string, Accumulator>;
}

function recordOneDevice(input: RecordOneInput): void {
    const instances = deviceComponentInstances(input.device.status);
    const eventTypes = eventComponentTypes(input.device);
    for (const [type, count] of instances) {
        const prior = input.components.get(type) ?? {
            deviceCount: 0,
            instanceCount: 0,
            hasEventHandler: false
        };
        input.components.set(type, {
            deviceCount: prior.deviceCount + 1,
            instanceCount: prior.instanceCount + count,
            hasEventHandler: prior.hasEventHandler || eventTypes.has(type)
        });
    }
}

interface MaterializeRowsInput {
    components: Map<string, Accumulator>;
    composerKeys: ReadonlySet<string>;
}

function materializeRows(input: MaterializeRowsInput): ComponentRow[] {
    const rows: ComponentRow[] = [];
    for (const [type, acc] of input.components) {
        rows.push(
            rowFromAccumulator({
                type,
                accumulator: acc,
                composerKeys: input.composerKeys
            })
        );
    }
    rows.sort((a, b) => a.type.localeCompare(b.type));
    return rows;
}

interface RowFromAccInput {
    type: string;
    accumulator: Accumulator;
    composerKeys: ReadonlySet<string>;
}

function rowFromAccumulator(input: RowFromAccInput): ComponentRow {
    return {
        type: input.type,
        deviceCount: input.accumulator.deviceCount,
        instanceCount: input.accumulator.instanceCount,
        hasComposer: input.composerKeys.has(input.type),
        hasEventHandler: input.accumulator.hasEventHandler
    };
}

function deriveUnknownTypes(rows: ComponentRow[]): string[] {
    return rows.filter((r) => !r.hasComposer).map((r) => r.type);
}

export function buildCoverage(devices: AbstractDevice[]): CoverageReport {
    const composerKeys = composerRegistryKeys();
    const acc = accumulateAll(devices);
    const rows = materializeRows({components: acc.components, composerKeys});
    return {
        totalDevices: devices.length,
        profiledDevices: acc.profiledDevices,
        tribes: acc.tribes,
        components: rows,
        unknownTypes: deriveUnknownTypes(rows)
    };
}
