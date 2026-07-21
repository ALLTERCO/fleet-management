// STATUS-event subscription options for the widget data contract.
//
// websocket.ts feeds the current on-screen component union in and sends the
// result via System.Subscribe.
//
// aenergy/em/wifi are always denied — they tick constantly and no card reads
// them live. `*:consumption` (apower/voltage/current) is denied ONLY when the
// page declares no components, so today's behaviour is preserved. When the page
// declares its on-screen components (paths), consumption is allowed and scoped
// to those components + devices, so live power streams for visible cards only.

import {SHELLY_EVENT} from '@/tools/wsEvents';

/** Constant noise never needed live. */
export const STATUS_DENY_NOISE: readonly string[] = [
    '*:aenergy',
    'em:*',
    'em1:*',
    'emdata:*',
    'emdata1:*',
    'wifi:*'
];

/** Noise plus consumption — used when the page declares no components. */
export const STATUS_DENY_FULL: readonly string[] = [
    '*:consumption',
    ...STATUS_DENY_NOISE
];

export interface DeviceComponentSub {
    shellyIDs: string[];
    paths: string[];
}

export interface StatusEventOptions {
    deny: string[];
    shellyIDs?: string[];
    paths?: string[];
}

export function buildStatusEventOptions(
    sub: DeviceComponentSub | null
): StatusEventOptions {
    if (!sub || sub.paths.length === 0) {
        return {deny: [...STATUS_DENY_FULL]};
    }
    return {
        deny: [...STATUS_DENY_NOISE],
        shellyIDs: sub.shellyIDs,
        paths: sub.paths
    };
}

/** Full System.Subscribe payload for the dashboard's scoped STATUS feed:
 *  a STATUS-only subscription scoped to the on-screen devices (shellyIDs) and
 *  components (paths), with consumption allowed and only aenergy/wifi/em noise
 *  denied. Added alongside the always-on baseline STATUS subscription. The
 *  event name comes from the SHELLY_EVENT SSOT, never a literal. */
export function buildComponentSubscriptionRequest(sub: DeviceComponentSub): {
    events: string[];
    options: {
        shellyIDs: string[];
        events: Record<string, {deny: string[]; paths: string[]}>;
    };
} {
    const status = SHELLY_EVENT.STATUS;
    const o = buildStatusEventOptions(sub);
    return {
        events: [status],
        options: {
            shellyIDs: o.shellyIDs ?? [],
            events: {
                [status]: {deny: o.deny, paths: o.paths ?? []}
            }
        }
    };
}
