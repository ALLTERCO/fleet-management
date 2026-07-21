import {
    AC_ACTIVE_POWER_COMPONENTS,
    componentActivePower,
    CONSUMED_ENERGY_PATH,
    devicePhaseChannels,
    emPhaseChannels,
    RETURNED_ENERGY_PATH,
    SINGLE_CURRENT_FIELD,
    SINGLE_VOLTAGE_FIELD
} from '@api/componentPower';
import {getDeviceName} from '@/helpers/device';

// Canonical EM channel type shared by store, components, and backend responses.
// Structurally identical to the SSOT EmPhaseChannel (channel 0/1/2 == L1/L2/L3).
export interface EmChannel {
    channel: number;
    act_power: number | null;
    voltage: number | null;
    current: number | null;
}

export interface PhaseMetrics {
    threePhaseDeviceCount: number;
    phases: {
        label: string;
        totalPower: number;
        avgVoltage: number | null;
        avgCurrent: number | null;
    }[];
    imbalancedCount: number;
    worstImbalanced: {
        deviceId: number;
        shellyId: string;
        deviceName: string;
        imbalancePct: number;
        channels: EmChannel[];
    }[];
}

// L1/L2/L3 labels for em:N channels; CH0/CH1/... for em1:N
export function phaseLabel(channel: number, type: 'em' | 'em1' = 'em'): string {
    if (type === 'em') return ['L1', 'L2', 'L3'][channel] ?? `L${channel + 1}`;
    return `CH${channel}`;
}

/**
 * Max power deviation as % of average across channels.
 * Returns null when fewer than 2 channels have valid readings.
 */
export function calcImbalance(channels: EmChannel[]): number | null {
    const powers = channels
        .map((c) => c.act_power)
        .filter((p): p is number => p !== null);
    if (powers.length < 2) return null;
    const avg = powers.reduce((a, b) => a + b, 0) / powers.length;
    // Skip when average phase power is <= 0 (net export / feed-in), matching
    // the backend PhaseAggregator; a negative avg would yield a nonsensical
    // negative imbalance %.
    if (avg <= 0) return null;
    const maxDev = Math.max(...powers.map((p) => Math.abs(p - avg)));
    return Math.round((maxDev / avg) * 100);
}

export function extractEmChannels(status: any): {
    emChannels: EmChannel[];
    em1Channels: EmChannel[];
} {
    const emChannels: EmChannel[] = [];
    const em1Channels: EmChannel[] = [];
    for (let i = 0; i < 5; i++) {
        const em = status[`em:${i}`];
        if (em) {
            // 3-phase em:N -> L1/L2/L3 channels (SSOT); em1:N stays bare below.
            for (const phase of emPhaseChannels(em)) emChannels.push(phase);
        }
        const em1 = status[`em1:${i}`];
        if (em1) {
            em1Channels.push({
                channel: i,
                act_power:
                    typeof em1.act_power === 'number' ? em1.act_power : null,
                voltage: typeof em1.voltage === 'number' ? em1.voltage : null,
                current: typeof em1.current === 'number' ? em1.current : null
            });
        }
    }
    return {emChannels, em1Channels};
}

/**
 * Computes fleet-level phase metrics from raw device status map.
 * Mirror of the backend fleet.GetMetrics phaseAgg logic — used in fleet (no-scope) mode
 * where all device statuses are already in memory on the client.
 * This runs once on data update, not on every render.
 */
export function computePhaseMetrics(
    deviceIds: number[],
    shellyIds: string[],
    deviceNames: string[],
    phaseChannelsList: EmChannel[][]
): PhaseMetrics | null {
    const phases = [
        {
            label: 'L1',
            totalPower: 0,
            sumVoltage: 0,
            countV: 0,
            sumCurrent: 0,
            countA: 0
        },
        {
            label: 'L2',
            totalPower: 0,
            sumVoltage: 0,
            countV: 0,
            sumCurrent: 0,
            countA: 0
        },
        {
            label: 'L3',
            totalPower: 0,
            sumVoltage: 0,
            countV: 0,
            sumCurrent: 0,
            countA: 0
        }
    ];
    let threePhaseDeviceCount = 0;
    let imbalancedCount = 0;
    const worstCandidates: PhaseMetrics['worstImbalanced'] = [];

    for (let d = 0; d < phaseChannelsList.length; d++) {
        const channels = phaseChannelsList[d];
        if (channels.length < 3) continue;

        threePhaseDeviceCount++;
        for (const ch of channels) {
            const p = phases[ch.channel];
            if (!p) continue;
            if (ch.act_power !== null) p.totalPower += ch.act_power;
            if (ch.voltage !== null) {
                p.sumVoltage += ch.voltage;
                p.countV++;
            }
            if (ch.current !== null) {
                p.sumCurrent += ch.current;
                p.countA++;
            }
        }

        const imbalancePct = calcImbalance(channels);
        if (imbalancePct !== null && imbalancePct > 20) {
            imbalancedCount++;
            worstCandidates.push({
                deviceId: deviceIds[d],
                shellyId: shellyIds[d],
                deviceName: deviceNames[d],
                imbalancePct,
                channels
            });
        }
    }

    if (threePhaseDeviceCount === 0) return null;

    return {
        threePhaseDeviceCount,
        phases: phases.map((p) => ({
            label: p.label,
            totalPower: p.totalPower,
            avgVoltage: p.countV > 0 ? p.sumVoltage / p.countV : null,
            avgCurrent: p.countA > 0 ? p.sumCurrent / p.countA : null
        })),
        imbalancedCount,
        worstImbalanced: worstCandidates
            .sort((a, b) => b.imbalancePct - a.imbalancePct)
            .slice(0, 8)
    };
}

// Channel indices probed on each component prefix; covers every shipped
// multi-channel Shelly device (em:0..4, switch:0..4, ...).
const CHANNEL_INDICES = [0, 1, 2, 3, 4] as const;
const ENERGY_SUB_INDICES = [0, 1, 2] as const;

interface ComponentFieldMap {
    voltage?: string;
    current?: string;
    consumption?: string;
    returned_energy?: string;
}

// Single-reading field shape shared by every single-phase AC-mains component.
// Field names come from componentPower.ts so the wire names have one home.
const AC_MAINS_FIELD_MAP: ComponentFieldMap = {
    voltage: SINGLE_VOLTAGE_FIELD,
    current: SINGLE_CURRENT_FIELD,
    consumption: CONSUMED_ENERGY_PATH,
    returned_energy: RETURNED_ENERGY_PATH
};

// Live-status power components. Mirror of the backend fleetLiveMetrics
// POWER_SOURCES: `em` is 3-phase (phase-expanded); every other AC power
// component reads one power value via componentActivePower plus the shared
// single-phase field shape; voltmeter is voltage-only. Driven by the one
// shared component list so fleet (no-scope) mode and scoped mode agree.
const POWER_SOURCES: readonly {prefix: string; fieldMap: ComponentFieldMap}[] = [
    {prefix: 'em', fieldMap: {}},
    ...AC_ACTIVE_POWER_COMPONENTS.filter((prefix) => prefix !== 'em').map(
        (prefix) => ({prefix, fieldMap: AC_MAINS_FIELD_MAP})
    ),
    {prefix: 'voltmeter', fieldMap: {voltage: SINGLE_VOLTAGE_FIELD}}
];

// Cumulative energy registers (Wh) on em/em1 devices — separate components.
const ENERGY_SOURCES: readonly {
    prefix: string;
    consumption: string;
    returned_energy: string;
}[] = [
    {prefix: 'emdata', consumption: 'total_act', returned_energy: 'total_act_ret'},
    {
        prefix: 'em1data',
        consumption: 'total_act_energy',
        returned_energy: 'total_act_ret_energy'
    }
];

type EnvMetricKey = 'temperature' | 'humidity' | 'luminance';

const ENV_SOURCES: readonly {
    prefix: string;
    metric: EnvMetricKey;
    path: string;
}[] = [
    {prefix: 'temperature:', metric: 'temperature', path: 'tC'},
    {prefix: 'humidity:', metric: 'humidity', path: 'rh'},
    {prefix: 'illuminance:', metric: 'luminance', path: 'lux'}
];

function readNumber(obj: any, path: string): number | null {
    if (obj == null || typeof obj !== 'object') return null;
    let cur: any = obj;
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[part];
    }
    return typeof cur === 'number' ? cur : null;
}

/**
 * Constructs a fleet.GetMetrics-compatible response object from the raw device store map.
 * Used by domain dashboard pages as a fallback when no scope is configured (fleet mode).
 */
export function buildLiveMetricsFromDevices(deviceMap: Record<string, any>) {
    const entries = Object.entries(deviceMap);

    const devices = entries.map(([shellyID, dev], idx) => {
        const status = dev?.status ?? {};
        const {emChannels, em1Channels} = extractEmChannels(status);
        return {
            id: dev?.id ?? idx + 1,
            shellyID,
            name: getDeviceName(dev?.info, shellyID),
            online: dev?.online ?? false,
            hasEmChannels: emChannels.length > 0,
            hasEm1Channels: em1Channels.length > 0,
            // Phase channels fold both profiles (em:0 a/b/c OR em1:0/1/2); count
            // decides 3-phase in computePhaseMetrics.
            _phaseChannels: devicePhaseChannels(status)
        };
    });

    const uptimeValues: {
        deviceId: number;
        deviceName: string;
        value: number;
    }[] = [];
    const voltageValues: {deviceId: number; value: number}[] = [];
    const currentValues: {deviceId: number; value: number}[] = [];
    const powerValues: {deviceId: number; value: number}[] = [];
    const consumptionValues: {deviceId: number; value: number}[] = [];
    const returnedEnergyValues: {deviceId: number; value: number}[] = [];
    const temperatureValues: {deviceId: number; value: number}[] = [];
    const humidityValues: {deviceId: number; value: number}[] = [];
    const luminanceValues: {deviceId: number; value: number}[] = [];

    const envArrays: Record<
        EnvMetricKey,
        {deviceId: number; value: number}[]
    > = {
        temperature: temperatureValues,
        humidity: humidityValues,
        luminance: luminanceValues
    };

    for (const dev of devices) {
        const deviceId = dev.id;
        const status = deviceMap[dev.shellyID]?.status ?? {};

        const uptime = readNumber(status, 'sys.uptime');
        if (uptime !== null)
            uptimeValues.push({deviceId, deviceName: dev.name, value: uptime});

        for (const src of POWER_SOURCES) {
            for (const idx of CHANNEL_INDICES) {
                const comp = status[`${src.prefix}:${idx}`];
                if (!comp || typeof comp !== 'object') continue;

                // 3-phase em:N -> feed each a/b/c phase separately.
                if (src.prefix === 'em') {
                    for (const phase of emPhaseChannels(comp)) {
                        if (phase.voltage !== null)
                            voltageValues.push({deviceId, value: phase.voltage});
                        if (phase.current !== null)
                            currentValues.push({deviceId, value: phase.current});
                        if (phase.act_power !== null)
                            powerValues.push({deviceId, value: phase.act_power});
                    }
                    continue;
                }

                const voltage = src.fieldMap.voltage
                    ? readNumber(comp, src.fieldMap.voltage)
                    : null;
                const current = src.fieldMap.current
                    ? readNumber(comp, src.fieldMap.current)
                    : null;
                const power = componentActivePower(comp);
                if (voltage !== null)
                    voltageValues.push({deviceId, value: voltage});
                if (current !== null)
                    currentValues.push({deviceId, value: current});
                if (power !== null) powerValues.push({deviceId, value: power});

                if (src.fieldMap.consumption) {
                    const consumed = readNumber(comp, src.fieldMap.consumption);
                    if (consumed !== null)
                        consumptionValues.push({
                            deviceId,
                            value: consumed / 1000
                        });
                }
                if (src.fieldMap.returned_energy) {
                    const returned = readNumber(
                        comp,
                        src.fieldMap.returned_energy
                    );
                    if (returned !== null)
                        returnedEnergyValues.push({
                            deviceId,
                            value: returned / 1000
                        });
                }
            }
        }

        // Cumulative energy registers on em/em1 meters (Wh -> kWh).
        for (const src of ENERGY_SOURCES) {
            for (const idx of ENERGY_SUB_INDICES) {
                const comp = status[`${src.prefix}:${idx}`];
                if (!comp || typeof comp !== 'object') continue;
                const consumed = readNumber(comp, src.consumption);
                const returned = readNumber(comp, src.returned_energy);
                if (consumed !== null)
                    consumptionValues.push({deviceId, value: consumed / 1000});
                if (returned !== null)
                    returnedEnergyValues.push({
                        deviceId,
                        value: returned / 1000
                    });
            }
        }

        // Environmental sensors — key-prefix scan since indices are open-ended.
        for (const key of Object.keys(status)) {
            const env = ENV_SOURCES.find((s) => key.startsWith(s.prefix));
            if (!env) continue;
            const value = readNumber(status[key], env.path);
            if (value !== null) envArrays[env.metric].push({deviceId, value});
        }
    }

    function calcStats(vals: {value: number}[]) {
        if (!vals.length) return {avg: 0, min: 0, max: 0};
        // One pass, no argument spread: Math.min(...nums) throws RangeError past
        // ~100k samples (large fleets), which would fail the whole build.
        let sum = 0;
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const {value} of vals) {
            sum += value;
            if (value < min) min = value;
            if (value > max) max = value;
        }
        return {avg: sum / vals.length, min, max};
    }

    function calcTotal(vals: {value: number}[]) {
        return vals.reduce((a, b) => a + b.value, 0);
    }

    const phaseMetrics = computePhaseMetrics(
        devices.map((d) => d.id),
        devices.map((d) => d.shellyID),
        devices.map((d) => d.name),
        devices.map((d) => d._phaseChannels)
    );

    // Strip internal _phaseChannels before returning
    const publicDevices = devices.map(({_phaseChannels: _, ...d}) => d);

    return {
        scopeKind: 'fleet' as const,
        scopeId: null,
        devices: publicDevices,
        phaseMetrics,
        metrics: {
            uptime: {...calcStats(uptimeValues), values: uptimeValues},
            voltage: {...calcStats(voltageValues), values: voltageValues},
            current: {...calcStats(currentValues), values: currentValues},
            power: {total: calcTotal(powerValues), values: powerValues},
            consumption: {
                total: calcTotal(consumptionValues),
                values: consumptionValues
            },
            returned_energy: {
                total: calcTotal(returnedEnergyValues),
                values: returnedEnergyValues
            },
            temperature: {
                ...calcStats(temperatureValues),
                values: temperatureValues
            },
            humidity: {...calcStats(humidityValues), values: humidityValues},
            luminance: {...calcStats(luminanceValues), values: luminanceValues}
        }
    };
}

// --- Tariff time --------------------------------------------------------

export interface LocalTimeParts {
    /** Wall-clock hour 0-23 in the tariff zone. */
    hour: number;
    /** Wall-clock minute 0-59 in the tariff zone. */
    minute: number;
    /** Zero-padded "HH:MM" wall-clock in the tariff zone (TOU window match). */
    hhmm: string;
    /** Weekday 0-6 (Sunday=0), matching Date.getUTCDay()/getDay(). */
    day: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
};

/**
 * Wall-clock hour and weekday of an instant in a tariff timezone. Time-of-use
 * pricing, the day/night split, and the usage heatmap read local time so a
 * non-UTC site classifies its rate windows and peak hours correctly. Falls back
 * to UTC when no zone is set (preserves the historical default).
 *
 * Single source of truth for tariff-local time — every dashboard cost/heatmap
 * calculator routes through here rather than re-deriving from getUTCHours().
 */
export function tariffLocalTime(
    timestamp: string | number | Date,
    timeZone?: string | null
): LocalTimeParts {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZone || 'UTC',
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short'
    }).formatToParts(date);
    let hour = 0;
    let minute = 0;
    let weekday = 'Sun';
    for (const part of parts) {
        if (part.type === 'hour') hour = Number(part.value);
        else if (part.type === 'minute') minute = Number(part.value);
        else if (part.type === 'weekday') weekday = part.value;
    }
    const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {hour, minute, hhmm, day: WEEKDAY_INDEX[weekday] ?? 0};
}
