// Channel-addressable live power. Pulls every instantaneous active-power
// reading out of a device's in-memory status — one entry per
// (component, phase) — so a custom UI can read a single channel, a chosen
// subset (e.g. 2 of 4 switches, or one phase of a 3-phase meter), or a sum.
// The field->power rule lives in one cross-runtime home: componentPower.

import {
    type ActivePowerPhase,
    componentPowerReadings
} from '../../types/api/componentPower';

export type Phase = ActivePowerPhase;

export interface PowerChannel {
    // Component instance the reading came from, e.g. "switch:0", "em:0".
    componentKey: string;
    // 'z' = single / whole-component reading; a|b|c = one phase of a meter.
    phase: Phase;
    // Signed instantaneous active power in watts. Caller decides gross vs net.
    watts: number;
}

// Minimal device shape — current status plus connectivity. AbstractDevice
// satisfies this via `online` and `get status()`.
export interface DeviceStatusView {
    online: boolean;
    status: Record<string, unknown> | null | undefined;
}

export function devicePowerChannels(dev: DeviceStatusView): PowerChannel[] {
    if (!dev.online || !dev.status) return [];
    const channels: PowerChannel[] = [];
    for (const componentKey of Object.keys(dev.status)) {
        const compStatus = dev.status[componentKey];
        if (compStatus === null || typeof compStatus !== 'object') continue;
        for (const reading of componentPowerReadings(
            compStatus as Record<string, unknown>
        )) {
            channels.push({
                componentKey,
                phase: reading.phase,
                watts: reading.watts
            });
        }
    }
    return channels;
}

export function sumChannels(channels: readonly PowerChannel[]): number {
    let total = 0;
    for (const c of channels) total += c.watts;
    return total;
}
