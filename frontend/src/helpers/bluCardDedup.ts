// Match a gateway's BLU sensor (bthomedevice child) to its promoted
// first-class device by BLE MAC, so the devices grid shows one card per
// physical sensor — sourced from the promoted device when it exists.

import {normalizeMac} from '@/helpers/device';
import type {shelly_device_t} from '@/types';

// Re-export so BLU-dedup consumers keep one import; the MAC helper's home is device.ts.
export {normalizeMac};

interface PromotedMeta {
    meta?: {bluetoothDevice?: {stableId?: string; bleAddress?: string}};
    source?: string;
}

/** Index promoted (source:'bluetooth') devices by their normalized MAC. */
export function buildPromotedBluByMac(
    devices: readonly shelly_device_t[]
): Map<string, shelly_device_t> {
    const map = new Map<string, shelly_device_t>();
    for (const dev of devices) {
        if ((dev as PromotedMeta).source !== 'bluetooth') continue;
        const bt = (dev as PromotedMeta).meta?.bluetoothDevice;
        // Index BOTH forms: a gateway child's addr may match either the stableId
        // or the bleAddress, so keying on one alone can miss and double-show.
        for (const raw of [bt?.stableId, bt?.bleAddress]) {
            const mac = normalizeMac(raw);
            if (mac) map.set(mac, dev);
        }
    }
    return map;
}

/** The promoted device for a gateway child's addr, if one exists. */
export function promotedForAddr(
    addr: string | undefined,
    byMac: Map<string, shelly_device_t>
): shelly_device_t | undefined {
    return byMac.get(normalizeMac(addr));
}
