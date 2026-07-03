import {HeatmapLayer} from '@deck.gl/aggregation-layers';
import type {Layer} from '@deck.gl/core';
import {viridisColorRange} from '@/helpers/viridis';

export interface HeatmapPoint {
    lat: number;
    lng: number;
    weight?: number;
}

// Viridis stops mapped to graduated alpha so low-density regions stay clear.
function heatmapColorRange(): Array<[number, number, number, number]> {
    const stops = viridisColorRange();
    // 6 evenly-spaced samples across the 10-stop palette.
    const idx = [0, 2, 4, 6, 8, 9];
    const alpha = [0, 80, 140, 190, 220, 240];
    return idx.map((i, n) => [stops[i][0], stops[i][1], stops[i][2], alpha[n]]);
}

export function heatmapLayer(
    id: string,
    points: HeatmapPoint[],
    radiusPixels = 60
): Layer {
    return new HeatmapLayer<HeatmapPoint>({
        id,
        data: points,
        getPosition: (d) => [d.lng, d.lat],
        getWeight: (d) => d.weight ?? 1,
        radiusPixels,
        intensity: 1,
        threshold: 0.05,
        colorRange: heatmapColorRange()
    });
}
