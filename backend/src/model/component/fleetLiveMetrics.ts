/**
 * Live-status metric + capability extraction for fleet.GetMetrics /
 * fleet.GetCapabilities. Backend is the source of truth for the shape of
 * `devices[]`, `metrics{}`, and `capabilities[]` returned to callers —
 * UIs never re-derive these.
 *
 * The four on-device power sources (em, em1, switch, pm1) and two
 * cumulative-energy sources (emdata, em1data) share a single extraction
 * loop driven by `POWER_SOURCES` / `ENERGY_SOURCES`. Adding a new source
 * is a one-line registry entry, not a new loop.
 */
import * as Observability from '../../modules/Observability';
import type {ScopeKind} from '../../types/api/fleet';
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

/** Live-status source → which metrics it feeds and the field path per metric. */
interface PowerSource {
    prefix: 'em' | 'em1' | 'switch' | 'pm1';
    /** Map metric key → dot-path under the channel object. */
    fieldMap: Partial<{
        voltage: string;
        current: string;
        power: string;
        consumption: string;
        returned_energy: string;
    }>;
}

const POWER_SOURCES: readonly PowerSource[] = [
    {
        prefix: 'em',
        fieldMap: {voltage: 'voltage', current: 'current', power: 'act_power'}
    },
    {
        prefix: 'em1',
        fieldMap: {voltage: 'voltage', current: 'current', power: 'act_power'}
    },
    {
        prefix: 'switch',
        fieldMap: {
            voltage: 'voltage',
            current: 'current',
            power: 'apower',
            consumption: 'aenergy.total',
            returned_energy: 'ret_aenergy.total'
        }
    },
    {
        prefix: 'pm1',
        fieldMap: {
            voltage: 'voltage',
            current: 'current',
            power: 'apower',
            consumption: 'aenergy.total',
            returned_energy: 'ret_aenergy.total'
        }
    }
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

interface EmChannel {
    channel: number;
    act_power: number | null;
    voltage: number | null;
    current: number | null;
}

/** Collect live-status metrics from one device into shared accumulators. */
function collectDeviceMetrics(
    device: AbstractDevice,
    metrics: Metrics,
    phases: PhaseAggregator
): {
    id: number;
    shellyID: string;
    name: string;
    hasEmChannels: boolean;
    hasEm1Channels: boolean;
} {
    const deviceId = device.id;
    const status = device.status ?? {};
    const name = (device.info?.name as string) || device.shellyID;

    const uptime = readNumber(status, 'sys.uptime');
    if (uptime !== null) pushStat(metrics.uptime, deviceId, uptime, name);

    const emChannels: EmChannel[] = [];
    let hasEm1 = false;

    for (const src of POWER_SOURCES) {
        for (const idx of CHANNEL_INDICES) {
            const ch = (status as Record<string, unknown>)[
                `${src.prefix}:${idx}`
            ];
            if (!ch || typeof ch !== 'object') continue;

            if (src.prefix === 'em1') hasEm1 = true;

            const v = readNumber(ch, src.fieldMap.voltage ?? '');
            const a = readNumber(ch, src.fieldMap.current ?? '');
            const p = readNumber(ch, src.fieldMap.power ?? '');

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

            if (src.prefix === 'em') {
                emChannels.push({
                    channel: idx,
                    voltage: v,
                    current: a,
                    act_power: p
                });
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

    phases.observeDevice({
        deviceId,
        shellyID: device.shellyID,
        name,
        emChannels
    });

    return {
        id: deviceId,
        shellyID: device.shellyID,
        name,
        hasEmChannels: emChannels.length > 0,
        hasEm1Channels: hasEm1
    };
}

/** Finalize avg/min/max + totals over accumulated sample lists. */
function finalize(metrics: Metrics): void {
    const finishStats = (b: StatsBucket) => {
        if (b.values.length === 0) return;
        const nums = b.values.map((v) => v.value);
        b.avg = nums.reduce((a, n) => a + n, 0) / nums.length;
        b.min = Math.min(...nums);
        b.max = Math.max(...nums);
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

    observeDevice(d: {
        deviceId: number;
        shellyID: string;
        name: string;
        emChannels: EmChannel[];
    }): void {
        if (d.emChannels.length < 2) return;
        this.threePhaseCount++;
        for (const ch of d.emChannels) {
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

        const powers = d.emChannels
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
            channels: d.emChannels
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
    devices: Array<{
        id: number;
        shellyID: string;
        name: string;
        hasEmChannels: boolean;
        hasEm1Channels: boolean;
    }>;
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
