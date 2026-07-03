// Live power per logical meter — the meter-aware side of Energy.Current. A
// meter owns (device, channel) pairs; a live PowerChannel belongs to it when
// its componentKey parses to that channel on that device. Pure: no collector,
// no DB. Phases of a channel sum; a channel is owned by one meter, so per-meter
// sums never double count.

import type {PowerChannel} from './livePowerChannels';

export interface MeterDeviceChannels {
    id: number;
    points: ReadonlyArray<{deviceId: number; channel: number}>;
}

export interface DeviceLive {
    online: boolean;
    channels: ReadonlyArray<PowerChannel>;
}

export interface MeterLiveResult {
    perMeter: Array<{meterId: number; watts: number}>;
    total: number;
    onlineDevices: number;
}

export function meterLiveWatts(
    meters: ReadonlyArray<MeterDeviceChannels>,
    deviceLive: ReadonlyMap<number, DeviceLive>
): MeterLiveResult {
    const perMeter = meters.map((m) => ({
        meterId: m.id,
        watts: meterWatts(m, deviceLive)
    }));
    const total = perMeter.reduce((acc, m) => acc + m.watts, 0);
    return {perMeter, total, onlineDevices: countOnline(meters, deviceLive)};
}

function meterWatts(
    meter: MeterDeviceChannels,
    deviceLive: ReadonlyMap<number, DeviceLive>
): number {
    let watts = 0;
    const seen = new Set<string>();
    for (const p of meter.points) {
        const key = `${p.deviceId}|${p.channel}`;
        if (seen.has(key)) continue; // a/b/c points share one channel
        seen.add(key);
        const live = deviceLive.get(p.deviceId);
        if (!live) continue;
        for (const c of live.channels) {
            if (parseChannel(c.componentKey) === p.channel) watts += c.watts;
        }
    }
    return watts;
}

function countOnline(
    meters: ReadonlyArray<MeterDeviceChannels>,
    deviceLive: ReadonlyMap<number, DeviceLive>
): number {
    const devices = new Set<number>();
    for (const m of meters) for (const p of m.points) devices.add(p.deviceId);
    let online = 0;
    for (const deviceId of devices) {
        if (deviceLive.get(deviceId)?.online) online++;
    }
    return online;
}

function parseChannel(componentKey: string): number {
    const colon = componentKey.indexOf(':');
    if (colon === -1) return 0;
    return Number.parseInt(componentKey.slice(colon + 1), 10) || 0;
}
