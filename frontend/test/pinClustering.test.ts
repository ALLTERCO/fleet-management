import {describe, expect, it} from 'vitest';
import {clusterPins} from '@/helpers/pinClustering';
import type {MapPin} from '@/types/map';

const WORLD_BBOX: [number, number, number, number] = [-180, -85, 180, 85];

function pin(id: string, lng: number, lat: number): MapPin {
    return {id, lat, lng};
}

describe('clusterPins', () => {
    it('returns empty buckets when no pins are supplied', () => {
        const result = clusterPins([], {bbox: WORLD_BBOX, zoom: 4});
        expect(result.clusters).toEqual([]);
        expect(result.loose).toEqual([]);
    });

    it('keeps a single pin loose — no cluster of one', () => {
        const result = clusterPins([pin('a', 0, 0)], {
            bbox: WORLD_BBOX,
            zoom: 4
        });
        expect(result.clusters).toEqual([]);
        expect(result.loose.map((p) => p.id)).toEqual(['a']);
    });

    it('clusters tightly grouped pins at low zoom', () => {
        const tight = [
            pin('a', 13.41, 52.52),
            pin('b', 13.42, 52.52),
            pin('c', 13.43, 52.53),
            pin('d', 13.44, 52.54)
        ];
        const result = clusterPins(tight, {bbox: WORLD_BBOX, zoom: 3});
        expect(result.clusters.length).toBeGreaterThan(0);
        expect(result.clusters[0].count).toBe(tight.length);
        expect(result.loose).toEqual([]);
    });

    it('separates pins on different continents into discrete loose pins', () => {
        const continents = [
            pin('berlin', 13.41, 52.52),
            pin('tokyo', 139.69, 35.69),
            pin('sf', -122.42, 37.77)
        ];
        const result = clusterPins(continents, {bbox: WORLD_BBOX, zoom: 10});
        expect(result.clusters).toEqual([]);
        expect(result.loose).toHaveLength(3);
    });

    it('honors a custom minPoints threshold', () => {
        const tight = [pin('a', 13.41, 52.52), pin('b', 13.42, 52.52)];
        const strict = clusterPins(
            tight,
            {bbox: WORLD_BBOX, zoom: 3},
            {minPoints: 3}
        );
        // Two pins shouldn't form a cluster when 3 is the floor.
        expect(strict.clusters).toEqual([]);
    });
});
