// Builds heatmap points from live device signal + location geo. Pure logic
// (no DB / DeviceCollector imports) so it's testable in isolation.

export interface HeatmapPoint {
    lat: number;
    lng: number;
    weight: number;
}

export interface DeviceAtLocation {
    shellyID: string;
    rssi: number | null | undefined;
    lat: number;
    lng: number;
}

/** Normalise an RSSI dBm value into a 0..1 weight.
 *  -100 dBm and below → 0 (no signal). -30 dBm and above → 1 (excellent).
 *  Linear between. */
export function normaliseRssi(rssi: number): number {
    if (!Number.isFinite(rssi)) return 0;
    const clamped = Math.max(-100, Math.min(-30, rssi));
    return (clamped + 100) / 70;
}

/** Project assigned devices onto heatmap points. Devices with missing RSSI
 *  or non-finite coords are dropped. */
export function buildSignalHeatmap(
    devices: readonly DeviceAtLocation[]
): HeatmapPoint[] {
    const out: HeatmapPoint[] = [];
    for (const d of devices) {
        if (typeof d.rssi !== 'number' || !Number.isFinite(d.rssi)) continue;
        if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) continue;
        out.push({lat: d.lat, lng: d.lng, weight: normaliseRssi(d.rssi)});
    }
    return out;
}
