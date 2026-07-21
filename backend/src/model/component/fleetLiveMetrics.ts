/**
 * Live-status metric + capability extraction for fleet.GetMetrics /
 * fleet.GetCapabilities. Backend is the source of truth for the shape of
 * `devices[]`, `metrics{}`, and `capabilities[]` returned to callers —
 * UIs never re-derive these.
 *
 * Active power always comes from the SSOT componentActivePower(); the list of
 * AC power components lives once in componentPower.ts
 * (AC_ACTIVE_POWER_COMPONENTS). Voltage/current/energy fields plus the
 * emdata/em1data registers drive a single extraction loop. Adding a metered
 * component type is one entry in the shared list, not a new loop here.
 *
 * Phase data (em a/b/c, em1:0/1/2) goes through `devicePhaseChannels`, not bare.
 */

import * as Observability from '../../modules/Observability';
import {
    AC_ACTIVE_POWER_COMPONENTS,
    CONSUMED_ENERGY_PATH,
    componentActivePower,
    devicePhaseChannels,
    type EmPhaseChannel,
    emPhaseChannels,
    RETURNED_ENERGY_PATH,
    SINGLE_CURRENT_FIELD,
    SINGLE_VOLTAGE_FIELD
} from '../../types/api/componentPower';
import type {FleetMetricsDevice, ScopeKind} from '../../types/api/fleet';
import type AbstractDevice from '../AbstractDevice';

/** Stats-style metric: average/min/max over samples. */
interface StatsBucket {
    avg: number;
    min: number;
    max: number;
    values: Array<{deviceId: number; deviceName?: string; value: number}>;
}
/** Totals-style metric: running sum of samples. */
interface TotalBucket {
    total: number;
    values: Array<{deviceId: number; value: number}>;
}

type MetricKey =
    | 'uptime'
    | 'voltage'
    | 'current'
    | 'temperature'
    | 'humidity'
    | 'luminance';
type TotalKey = 'power' | 'consumption' | 'returned_energy';

type Metrics = Record<MetricKey, StatsBucket> & Record<TotalKey, TotalBucket>;

function emptyMetrics(): Metrics {
    const stats = (): StatsBucket => ({avg: 0, min: 0, max: 0, values: []});
    const totals = (): TotalBucket => ({total: 0, values: []});
    return {
        uptime: stats(),
        voltage: stats(),
        current: stats(),
        temperature: stats(),
        humidity: stats(),
        luminance: stats(),
        power: totals(),
        consumption: totals(),
        returned_energy: totals()
    };
}

/**
 * Indices probed on each component prefix. Max 5 covers every shipped
 * Shelly multi-channel device (em:0..4, switch:0..4, pm1:0..4). If a
 * future model adds channel 5, bump the range here only.
 */
const CHANNEL_INDICES = [0, 1, 2, 3, 4] as const;
const ENERGY_SUB_INDICES = [0, 1, 2] as const;

/** Live-status source → the single-reading fields it feeds. Active power is NOT
 *  here — it always comes from the SSOT componentActivePower(). `em` is 3-phase
 *  and phase-expanded instead. All field names come from componentPower.ts. */
interface PowerSource {
    prefix: string;
    fieldMap: Partial<{
        voltage: string;
        current: string;
        consumption: string;
        returned_energy: string;
    }>;
}

// One field shape for every single-phase AC-mains component (same set the
// ingestion classifier uses). A missing field reads null and is skipped, so
// cct (no energy) and rgbcct (no voltage/current) need no special case.
const AC_MAINS_FIELD_MAP: PowerSource['fieldMap'] = {
    voltage: SINGLE_VOLTAGE_FIELD,
    current: SINGLE_CURRENT_FIELD,
    consumption: CONSUMED_ENERGY_PATH,
    returned_energy: RETURNED_ENERGY_PATH
};

const POWER_SOURCES: readonly PowerSource[] = [
    // 3-phase: phase-expanded via emPhaseChannels(), power summed per phase.
    {prefix: 'em', fieldMap: {}},
    // Every other AC power component reads one power value (componentActivePower)
    // plus the shared field shape — driven by the one component list.
    ...AC_ACTIVE_POWER_COMPONENTS.filter((prefix) => prefix !== 'em').map(
        (prefix) => ({prefix, fieldMap: AC_MAINS_FIELD_MAP})
    ),
    // Voltmeter is voltage-only (no power/energy).
    {prefix: 'voltmeter', fieldMap: {voltage: SINGLE_VOLTAGE_FIELD}}
];

/** Cumulative energy registers (separate component on em/em1 devices). */
interface EnergySource {
    prefix: 'emdata' | 'em1data';
    fieldMap: {consumption: string; returned_energy: string};
    /** Display units on the device: Wh vs kWh. */
    wh: boolean;
}

const ENERGY_SOURCES: readonly EnergySource[] = [
    {
        prefix: 'emdata',
        fieldMap: {consumption: 'total_act', returned_energy: 'total_act_ret'},
        wh: true
    },
    {
        prefix: 'em1data',
        fieldMap: {
            consumption: 'total_act_energy',
            returned_energy: 'total_act_ret_energy'
        },
        wh: true
    }
];

/** Environmental sensor key prefixes → metric bucket + value path. */
const ENV_SOURCES: readonly {
    prefix: string;
    metric: MetricKey;
    path: string;
}[] = [
    {prefix: 'temperature:', metric: 'temperature', path: 'tC'},
    {prefix: 'humidity:', metric: 'humidity', path: 'rh'},
    {prefix: 'illuminance:', metric: 'luminance', path: 'lux'}
];

/** Entity type → capabilities it contributes. Single source of truth for GetCapabilities. */
const ENTITY_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
    em: ['voltage', 'current', 'power', 'consumption', 'returned_energy'],
    em1: ['voltage', 'current', 'power', 'consumption', 'returned_energy'],
    switch: ['voltage', 'current', 'power', 'consumption'],
    pm1: ['voltage', 'current', 'power', 'consumption'],
    cover: ['voltage', 'current', 'power', 'consumption'],
    light: ['voltage', 'current', 'power', 'consumption'],
    rgb: ['voltage', 'current', 'power', 'consumption'],
    rgbw: ['voltage', 'current', 'power', 'consumption'],
    cct: ['voltage', 'current', 'power'],
    rgbcct: ['power', 'consumption'],
    voltmeter: ['voltage'],
    temperature: ['temperature'],
    humidity: ['humidity'],
    illuminance: ['luminance'],
    lux: ['luminance']
};

function readPath(obj: unknown, path: string): unknown {
    if (obj == null || typeof obj !== 'object') return undefined;
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

function readNumber(obj: unknown, path: string): number | null {
    const v = readPath(obj, path);
    return typeof v === 'number' ? v : null;
}

/**
 * Sum a device's live cumulative returned (exported) active energy in Wh,
 * across every metering channel. Reuses the `returned_energy` field paths in
 * POWER_SOURCES + ENERGY_SOURCES so the Shelly field names for returned energy
 * live in exactly one home. Per Shelly device APIs, returned active energy is
 * Wh on every component family: emdata `total_act_ret`, em1data
 * `total_act_ret_energy`, switch/pm1 `ret_aenergy.total`. Non-metered devices
 * return 0.
 */
export function deviceReturnedEnergyWh(device: AbstractDevice): number {
    const status = (device.status ?? {}) as Record<string, unknown>;
    let wh = 0;
    for (const src of POWER_SOURCES) {
        const path = src.fieldMap.returned_energy;
        if (!path) continue;
        for (const idx of CHANNEL_INDICES) {
            const ch = status[`${src.prefix}:${idx}`];
            if (!ch || typeof ch !== 'object') continue;
            const er = readNumber(ch, path);
            if (er !== null) wh += er;
        }
    }
    for (const src of ENERGY_SOURCES) {
        for (const idx of ENERGY_SUB_INDICES) {
            const ch = status[`${src.prefix}:${idx}`];
            if (!ch) continue;
            const er = readNumber(ch, src.fieldMap.returned_energy);
            // src.wh true => device value already Wh; false => kWh, scale up.
            if (er !== null) wh += src.wh ? er : er * 1000;
        }
    }
    return wh;
}

function pushStat(
    bucket: StatsBucket,
    deviceId: number,
    value: number,
    deviceName?: string
): void {
    bucket.values.push({deviceId, value, deviceName});
}
function pushTotal(bucket: TotalBucket, deviceId: number, value: number): void {
    bucket.values.push({deviceId, value});
}

// Phase channel shape is the SSOT EmPhaseChannel (channel 0/1/2 == L1/L2/L3).
type EmChannel = EmPhaseChannel;

/** Collect live-status metrics from one device into shared accumulators. */
function collectDeviceMetrics(
    device: AbstractDevice,
    metrics: Metrics,
    phases: PhaseAggregator
): FleetMetricsDevice {
    const deviceId = device.id;
    const status = device.status ?? {};
    const name = (device.info?.name as string) || device.shellyID;

    const uptime = readNumber(status, 'sys.uptime');
    if (uptime !== null) pushStat(metrics.uptime, deviceId, uptime, name);

    let hasEm = false;
    let hasEm1 = false;

    for (const src of POWER_SOURCES) {
        for (const idx of CHANNEL_INDICES) {
            const ch = (status as Record<string, unknown>)[
                `${src.prefix}:${idx}`
            ];
            if (!ch || typeof ch !== 'object') continue;

            // 3-phase em:N -> feed each a/b/c phase into the general metrics.
            if (src.prefix === 'em') {
                hasEm = true;
                for (const phase of emPhaseChannels(
                    ch as Record<string, unknown>
                )) {
                    if (phase.voltage !== null)
                        pushStat(metrics.voltage, deviceId, phase.voltage);
                    if (phase.current !== null)
                        pushStat(metrics.current, deviceId, phase.current);
                    if (phase.act_power !== null)
                        pushTotal(metrics.power, deviceId, phase.act_power);
                }
                continue;
            }

            if (src.prefix === 'em1') hasEm1 = true;

            const v = readNumber(ch, src.fieldMap.voltage ?? '');
            const a = readNumber(ch, src.fieldMap.current ?? '');
            const p = componentActivePower(ch as Record<string, unknown>);

            if (v !== null) pushStat(metrics.voltage, deviceId, v);
            if (a !== null) pushStat(metrics.current, deviceId, a);
            if (p !== null) pushTotal(metrics.power, deviceId, p);

            if (src.fieldMap.consumption) {
                const e = readNumber(ch, src.fieldMap.consumption);
                if (e !== null)
                    pushTotal(metrics.consumption, deviceId, e / 1000);
            }
            if (src.fieldMap.returned_energy) {
                const er = readNumber(ch, src.fieldMap.returned_energy);
                if (er !== null)
                    pushTotal(metrics.returned_energy, deviceId, er / 1000);
            }
        }
    }

    // Dedicated cumulative-energy registers on em/em1 devices.
    for (const src of ENERGY_SOURCES) {
        for (const idx of ENERGY_SUB_INDICES) {
            const ch = (status as Record<string, unknown>)[
                `${src.prefix}:${idx}`
            ];
            if (!ch) continue;
            const e = readNumber(ch, src.fieldMap.consumption);
            const er = readNumber(ch, src.fieldMap.returned_energy);
            const scale = src.wh ? 1000 : 1;
            if (e !== null) pushTotal(metrics.consumption, deviceId, e / scale);
            if (er !== null)
                pushTotal(metrics.returned_energy, deviceId, er / scale);
        }
    }

    // Environmental sensors — key prefix scan since indices are open-ended.
    for (const key of Object.keys(status)) {
        const env = ENV_SOURCES.find((e) => key.startsWith(e.prefix));
        if (!env) continue;
        const val = readNumber(
            (status as Record<string, unknown>)[key],
            env.path
        );
        if (val !== null) pushStat(metrics[env.metric], deviceId, val);
    }

    // Both Pro 3EM profiles are one 3-phase device: em:0 (a/b/c) OR em1:0/1/2.
    phases.observeDevice({
        deviceId,
        shellyID: device.shellyID,
        name,
        channels: devicePhaseChannels(status as Record<string, unknown>)
    });

    return {
        id: deviceId,
        shellyID: device.shellyID,
        name,
        online: device.online ?? false,
        hasEmChannels: hasEm,
        hasEm1Channels: hasEm1
    };
}

/** Finalize avg/min/max + totals over accumulated sample lists. */
function finalize(metrics: Metrics): void {
    const finishStats = (b: StatsBucket) => {
        if (b.values.length === 0) return;
        // One pass, no argument spread: Math.min(...nums) throws RangeError past
        // ~100k samples (large fleets), which would fail the whole metrics call.
        let sum = 0;
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const {value} of b.values) {
            sum += value;
            if (value < min) min = value;
            if (value > max) max = value;
        }
        b.avg = sum / b.values.length;
        b.min = min;
        b.max = max;
    };
    const finishTotal = (b: TotalBucket) => {
        b.total = b.values.reduce((a, v) => a + v.value, 0);
    };
    finishStats(metrics.uptime);
    finishStats(metrics.voltage);
    finishStats(metrics.current);
    finishStats(metrics.temperature);
    finishStats(metrics.humidity);
    finishStats(metrics.luminance);
    finishTotal(metrics.power);
    finishTotal(metrics.consumption);
    finishTotal(metrics.returned_energy);
}

// --- Phase imbalance ----------------------------------------------------

/** Threshold above which a 3-phase device is flagged imbalanced (%). */
const IMBALANCE_THRESHOLD_PCT = 20;
/** Worst-offender list cap returned to the UI. */
const WORST_IMBALANCED_LIMIT = 8;

interface WorstCandidate {
    deviceId: number;
    shellyId: string;
    deviceName: string;
    imbalancePct: number;
    channels: EmChannel[];
}

class PhaseAggregator {
    threePhaseCount = 0;
    imbalancedCount = 0;
    readonly phases = [
        {label: 'L1', totalPower: 0, sumV: 0, countV: 0, sumA: 0, countA: 0},
        {label: 'L2', totalPower: 0, sumV: 0, countV: 0, sumA: 0, countA: 0},
        {label: 'L3', totalPower: 0, sumV: 0, countV: 0, sumA: 0, countA: 0}
    ];
    readonly worst: WorstCandidate[] = [];

    // 3-phase == 3 phase channels: one em:0 (a/b/c) OR three em1:0/1/2. Fewer
    // (Pro EM's two em1) stays independent single-phase and is not counted.
    observeDevice(d: {
        deviceId: number;
        shellyID: string;
        name: string;
        channels: EmChannel[];
    }): void {
        if (d.channels.length < 3) return;
        this.threePhaseCount++;
        for (const ch of d.channels) {
            const p = this.phases[ch.channel];
            if (!p) continue;
            if (ch.act_power !== null) p.totalPower += ch.act_power;
            if (ch.voltage !== null) {
                p.sumV += ch.voltage;
                p.countV++;
            }
            if (ch.current !== null) {
                p.sumA += ch.current;
                p.countA++;
            }
        }

        const powers = d.channels
            .map((c) => c.act_power)
            .filter((p): p is number => p !== null);
        if (powers.length < 2) return;
        const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
        if (avg <= 0) return;
        const maxDev = Math.max(...powers.map((p) => Math.abs(p - avg)));
        const imbalancePct = Math.round((maxDev / avg) * 100);
        if (imbalancePct <= IMBALANCE_THRESHOLD_PCT) return;
        this.imbalancedCount++;
        this.worst.push({
            deviceId: d.deviceId,
            shellyId: d.shellyID,
            deviceName: d.name,
            imbalancePct,
            channels: d.channels
        });
    }

    snapshot() {
        if (this.threePhaseCount === 0) return null;
        return {
            threePhaseDeviceCount: this.threePhaseCount,
            phases: this.phases.map((p) => ({
                label: p.label,
                totalPower: p.totalPower,
                avgVoltage: p.countV > 0 ? p.sumV / p.countV : null,
                avgCurrent: p.countA > 0 ? p.sumA / p.countA : null
            })),
            imbalancedCount: this.imbalancedCount,
            worstImbalanced: [...this.worst]
                .sort((a, b) => b.imbalancePct - a.imbalancePct)
                .slice(0, WORST_IMBALANCED_LIMIT)
        };
    }
}

// --- Public API ---------------------------------------------------------

export interface ScopeMetricsResult {
    scopeKind: ScopeKind;
    scopeId: number | null;
    devices: FleetMetricsDevice[];
    metrics: Metrics;
    phaseMetrics: ReturnType<PhaseAggregator['snapshot']>;
}

/** Aggregate live-status metrics across a scope's devices. */
export function computeFleetMetrics(
    scopeKind: ScopeKind,
    scopeId: number | null,
    devices: readonly AbstractDevice[]
): ScopeMetricsResult {
    const metrics = emptyMetrics();
    const phases = new PhaseAggregator();
    const deviceInfos: ScopeMetricsResult['devices'] = [];

    let failed = 0;
    for (const device of devices) {
        try {
            deviceInfos.push(collectDeviceMetrics(device, metrics, phases));
        } catch {
            failed++;
        }
    }
    if (failed > 0) {
        Observability.incrementCounter('fleet_metrics_device_failures', failed);
    }
    finalize(metrics);

    return {
        scopeKind,
        scopeId,
        devices: deviceInfos,
        metrics,
        phaseMetrics: phases.snapshot()
    };
}

/** Derive capability keys for a scope from its devices' entity types. */
export function computeFleetCapabilities(
    scopeKind: ScopeKind,
    scopeId: number | null,
    devices: readonly AbstractDevice[],
    deviceCount: number
): {
    scopeKind: ScopeKind;
    scopeId: number | null;
    capabilities: string[];
    deviceCount: number;
} {
    const out = new Set<string>();
    for (const device of devices) {
        out.add('uptime');
        for (const entity of device.entities ?? []) {
            const caps = ENTITY_CAPABILITIES[entity.type];
            if (caps) for (const c of caps) out.add(c);
        }
    }
    return {scopeKind, scopeId, capabilities: [...out], deviceCount};
}
