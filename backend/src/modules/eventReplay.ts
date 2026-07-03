// Groups a flat (shellyID, ts, lng, lat) row sequence into per-device
// TripPath records ready for deck.gl TripsLayer. Pure logic, no I/O.

export interface EventReplayRow {
    shellyID: string;
    /** Unix epoch seconds. */
    tsEpoch: number;
    lat: number;
    lng: number;
}

export interface TripPath {
    id: string;
    /** Ordered [lng, lat] pairs — TripsLayer convention. */
    path: Array<[number, number]>;
    /** Ordered Unix epoch seconds, aligned 1:1 with `path`. */
    timestamps: number[];
}

/** Bucket rows by shellyID, preserving chronological order within each bucket.
 *  Drops rows missing finite coords or timestamp. Caller bounds `maxDevices`
 *  to avoid unbounded fan-out on noisy fleets. */
export function buildTripPaths(
    rows: readonly EventReplayRow[],
    maxDevices: number
): TripPath[] {
    const byDevice = new Map<string, TripPath>();
    for (const row of rows) {
        if (!Number.isFinite(row.tsEpoch)) continue;
        if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) continue;
        let trip = byDevice.get(row.shellyID);
        if (!trip) {
            if (byDevice.size >= maxDevices) continue;
            trip = {id: row.shellyID, path: [], timestamps: []};
            byDevice.set(row.shellyID, trip);
        }
        trip.path.push([row.lng, row.lat]);
        trip.timestamps.push(row.tsEpoch);
    }
    return [...byDevice.values()];
}
