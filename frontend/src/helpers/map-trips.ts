import type {Layer} from '@deck.gl/core';
import {TripsLayer} from '@deck.gl/geo-layers';

export interface TripPath {
    id: string;
    path: Array<[number, number]>;
    timestamps: number[];
    color?: [number, number, number];
}

// TripsLayer factory. currentTime is driven externally (scrubber RAF).
export function tripsLayer(
    id: string,
    trips: TripPath[],
    currentTime: number,
    trailLengthSec = 300
): Layer {
    return new TripsLayer<TripPath>({
        id,
        data: trips,
        getPath: (d) => d.path,
        getTimestamps: (d) => d.timestamps,
        getColor: (d) => d.color ?? [99, 179, 237],
        currentTime,
        trailLength: trailLengthSec,
        widthMinPixels: 2,
        capRounded: true,
        jointRounded: true
    });
}
