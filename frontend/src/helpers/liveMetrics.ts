import {getDeviceName} from '@/helpers/device';

// Canonical EM channel type shared by store, components, and backend responses
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
    if (avg === 0) return null;
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
            emChannels.push({
                channel: i,
                act_power:
                    typeof em.act_power === 'number' ? em.act_power : null,
                voltage: typeof em.voltage === 'number' ? em.voltage : null,
                current: typeof em.current === 'number' ? em.current : null
            });
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
    emChannelsList: EmChannel[][]
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

    for (let d = 0; d < emChannelsList.length; d++) {
        const channels = emChannelsList[d];
        if (channels.length <= 1) continue;

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
            hasEmChannels: emChannels.length > 0,
            hasEm1Channels: em1Channels.length > 0,
            // Keep full channel data in the intermediate structure for computePhaseMetrics
            _emChannels: emChannels
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
    const temperatureValues: {deviceId: number; value: number}[] = [];
    const humidityValues: {deviceId: number; value: number}[] = [];
    const luminanceValues: {deviceId: number; value: number}[] = [];

    for (const dev of devices) {
        const status = deviceMap[dev.shellyID]?.status ?? {};

        if (status.sys?.uptime != null) {
            uptimeValues.push({
                deviceId: dev.id,
                deviceName: dev.name,
                value: status.sys.uptime
            });
        }

        for (let i = 0; i < 5; i++) {
            const sw = status[`switch:${i}`];
            if (sw) {
                if (sw.voltage != null)
                    voltageValues.push({deviceId: dev.id, value: sw.voltage});
                if (sw.current != null)
                    currentValues.push({deviceId: dev.id, value: sw.current});
                if (sw.apower != null)
                    powerValues.push({deviceId: dev.id, value: sw.apower});
                if (sw.aenergy?.total != null)
                    consumptionValues.push({
                        deviceId: dev.id,
                        value: sw.aenergy.total / 1000
                    });
            }
            const em = status[`em:${i}`];
            if (em) {
                if (em.voltage != null)
                    voltageValues.push({deviceId: dev.id, value: em.voltage});
                if (em.current != null)
                    currentValues.push({deviceId: dev.id, value: em.current});
                if (em.act_power != null)
                    powerValues.push({deviceId: dev.id, value: em.act_power});
            }
            const em1 = status[`em1:${i}`];
            if (em1) {
                if (em1.voltage != null)
                    voltageValues.push({deviceId: dev.id, value: em1.voltage});
                if (em1.current != null)
                    currentValues.push({deviceId: dev.id, value: em1.current});
                if (em1.act_power != null)
                    powerValues.push({deviceId: dev.id, value: em1.act_power});
            }
            const pm = status[`pm1:${i}`];
            if (pm) {
                if (pm.voltage != null)
                    voltageValues.push({deviceId: dev.id, value: pm.voltage});
                if (pm.current != null)
                    currentValues.push({deviceId: dev.id, value: pm.current});
                if (pm.apower != null)
                    powerValues.push({deviceId: dev.id, value: pm.apower});
                if (pm.aenergy?.total != null)
                    consumptionValues.push({
                        deviceId: dev.id,
                        value: pm.aenergy.total / 1000
                    });
            }
        }

        for (const key of Object.keys(status)) {
            if (key.startsWith('temperature:') && status[key]?.tC != null) {
                temperatureValues.push({
                    deviceId: dev.id,
                    value: status[key].tC
                });
            }
            if (key.startsWith('humidity:') && status[key]?.rh != null) {
                humidityValues.push({deviceId: dev.id, value: status[key].rh});
            }
            if (key.startsWith('illuminance:') && status[key]?.lux != null) {
                luminanceValues.push({
                    deviceId: dev.id,
                    value: status[key].lux
                });
            }
        }
    }

    function calcStats(vals: {value: number}[]) {
        if (!vals.length) return {avg: 0, min: 0, max: 0};
        const nums = vals.map((v) => v.value);
        return {
            avg: nums.reduce((a, b) => a + b, 0) / nums.length,
            min: Math.min(...nums),
            max: Math.max(...nums)
        };
    }

    function calcTotal(vals: {value: number}[]) {
        return vals.reduce((a, b) => a + b.value, 0);
    }

    const lumAvg = luminanceValues.length
        ? luminanceValues.reduce((a, b) => a + b.value, 0) /
          luminanceValues.length
        : 0;

    const phaseMetrics = computePhaseMetrics(
        devices.map((d) => d.id),
        devices.map((d) => d.shellyID),
        devices.map((d) => d.name),
        devices.map((d) => d._emChannels)
    );

    // Strip internal _emChannels before returning
    const publicDevices = devices.map(({_emChannels: _, ...d}) => d);

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
            returned_energy: {total: 0, values: []},
            temperature: {
                ...calcStats(temperatureValues),
                values: temperatureValues
            },
            humidity: {...calcStats(humidityValues), values: humidityValues},
            luminance: {avg: lumAvg, values: luminanceValues}
        }
    };
}
