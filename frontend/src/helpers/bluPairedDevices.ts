/** A BLU paired to a gateway, as both BLU panels need it: the manage list
 *  renders these, the discover panel filters sightings against them. */
export type PairedBluDevice = {
    id: number;
    addr: string;
    name: string | null;
    productName: string | null;
    modelId: string | null;
    sensorCount: number;
    battery: number | null;
    rssi: number | null;
};

const DEVICE_KEY = 'bthomedevice:';
const SENSOR_KEY = 'bthomesensor:';

type ComponentMap = Record<string, any> | undefined;

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
}

/** How many sensors each address contributes, in one pass over the settings. */
function countSensorsByAddr(settings: Record<string, any>) {
    const counts: Record<string, number> = {};
    for (const key of Object.keys(settings)) {
        if (!key.startsWith(SENSOR_KEY)) continue;
        const addr = settings[key]?.addr;
        if (addr) counts[addr] = (counts[addr] ?? 0) + 1;
    }
    return counts;
}

export function readPairedBluDevices(
    settings: ComponentMap,
    status: ComponentMap
): PairedBluDevice[] {
    const config = settings ?? {};
    const liveStatus = status ?? {};
    const sensorsByAddr = countSensorsByAddr(config);

    const devices: PairedBluDevice[] = [];
    for (const key of Object.keys(config)) {
        if (!key.startsWith(DEVICE_KEY)) continue;
        const cfg = config[key] ?? {};
        const deviceStatus = liveStatus[key] ?? {};
        devices.push({
            id: cfg.id ?? Number.parseInt(key.slice(DEVICE_KEY.length), 10),
            addr: cfg.addr ?? '?',
            name: cfg.name ?? null,
            productName: cfg.meta?.productName ?? null,
            modelId: cfg.meta?.modelId ?? null,
            sensorCount: sensorsByAddr[cfg.addr] ?? 0,
            battery: numberOrNull(deviceStatus.battery),
            rssi: numberOrNull(deviceStatus.rssi)
        });
    }
    return devices;
}

/** Upper-cased, because a gateway reports a sighting in whatever case it likes. */
export function pairedBluAddresses(
    devices: readonly PairedBluDevice[]
): Set<string> {
    return new Set(devices.map((d) => d.addr.toUpperCase()));
}
