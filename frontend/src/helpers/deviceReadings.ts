// Small device-level readings shared by the per-sensor cards, so each card
// doesn't re-implement them. The battery CARD resolves its own precise value
// (addr-matched); these are the health readings other cards show as a stat.

interface DeviceLike {
    status?: Record<string, any>;
    entities?: string[];
}

type EntityLookup = (
    id: string
) => {type?: string; properties?: {id?: number; objName?: string}} | undefined;

/** Battery % for a health stat — devicepower (WiFi sleeper), the sibling BTHome
 *  battery sensor (BLU obj 0x01), or the BLU device-level battery. Null when the
 *  device reports no battery. */
export function deviceBatteryPercent(
    device?: DeviceLike,
    getEntity?: EntityLookup
): number | null {
    const s = device?.status;
    if (!s) return null;
    const dp = s['devicepower:0']?.battery?.percent;
    if (typeof dp === 'number') return dp;
    const sibling = bthomeSiblingValue(device, getEntity, 'battery');
    if (sibling !== null) return sibling;
    for (const key of Object.keys(s)) {
        if (
            key.startsWith('bthomedevice:') &&
            typeof s[key]?.battery === 'number'
        )
            return s[key].battery;
    }
    return null;
}

// Value of a sibling BTHome sensor on the same device, matched by objName.
function bthomeSiblingValue(
    device: DeviceLike | undefined,
    getEntity: EntityLookup | undefined,
    objName: string
): number | null {
    const s = device?.status;
    if (!s || !getEntity) return null;
    for (const id of device?.entities ?? []) {
        const e = getEntity(id);
        if (e?.type === 'bthomesensor' && e.properties?.objName === objName) {
            const v = s[`bthomesensor:${e.properties?.id}`]?.value;
            if (typeof v === 'number') return Math.round(v);
        }
    }
    return null;
}

/** Light level in lux — native illuminance:0, or the sibling BTHome
 *  illuminance sensor (BLU door/window/motion report light separately). */
export function deviceLux(
    device?: DeviceLike,
    getEntity?: EntityLookup
): number | null {
    const native = device?.status?.['illuminance:0']?.lux;
    if (typeof native === 'number') return Math.round(native);
    return bthomeSiblingValue(device, getEntity, 'illuminance');
}

/** BLU 3-state light level (BTHome 0x64: 0 dark, 1 twilight, 2 bright) from the
 *  sibling light_level sensor. Newer BLU devices (ZB door/window, presence)
 *  report this coarse level instead of lux. Null when not reported. */
export function deviceLightLevel(
    device?: DeviceLike,
    getEntity?: EntityLookup
): number | null {
    return bthomeSiblingValue(device, getEntity, 'light_level');
}

/** Tilt angle in degrees from the sibling BTHome rotation sensor (BLU
 *  door/window report tilt separately). */
export function deviceTilt(
    device?: DeviceLike,
    getEntity?: EntityLookup
): number | null {
    return bthomeSiblingValue(device, getEntity, 'rotation');
}

/** Signal strength in dBm. Wi-Fi devices report their own link RSSI (wifi.rssi).
 *  A BLU sensor's own BTHome broadcast has no RSSI object — the gateway measures
 *  it and reports it, per BLU device, on its BTHome-device component
 *  (bthomedevice:N.rssi). Virtual-device modelling carries the same value on the
 *  bluetooth transport health. Null when unknown. */
export function deviceRssi(device?: DeviceLike): number | null {
    const s = device?.status;
    if (!s) return null;
    if (typeof s.wifi?.rssi === 'number') return s.wifi.rssi;
    for (const key of Object.keys(s)) {
        if (key.startsWith('bthomedevice:') && typeof s[key]?.rssi === 'number')
            return s[key].rssi;
    }
    const bt = s.bluetoothdevice?.transportHealth?.lastRssi;
    if (typeof bt === 'number') return bt;
    return null;
}

/** Relative "time ago" from a unix-seconds timestamp; null when unknown. */
export function formatTimeAgo(tsSeconds?: number | null): string | null {
    if (typeof tsSeconds !== 'number' || !tsSeconds) return null;
    const diff = Math.floor(Date.now() / 1000) - tsSeconds;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

/** "Last seen" from the device's report timestamp; null when unknown. */
export function deviceLastSeen(device?: DeviceLike): string | null {
    const s = device?.status;
    return formatTimeAgo(s?.sys?.unixtime ?? s?.ts);
}
