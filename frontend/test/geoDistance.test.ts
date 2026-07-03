import {describe, expect, it} from 'vitest';
import {geoDistanceMeters} from '@/helpers/geoDistance';

describe('great-circle distance between two points', () => {
    it('is zero between identical points', () => {
        expect(geoDistanceMeters({lat: 42.65, lng: 23.31}, {lat: 42.65, lng: 23.31})).toBe(0);
    });

    it('measures ~111 m for a thousandth of a degree of longitude at the equator', () => {
        const d = geoDistanceMeters({lat: 0, lng: 0}, {lat: 0, lng: 0.001});
        expect(Math.abs(d - 111.32)).toBeLessThan(1);
    });

    it('measures the ~1.4 km gap between an old and corrected Sofia pin', () => {
        const d = geoDistanceMeters(
            {lat: 42.6705, lng: 23.3179},
            {lat: 42.65803, lng: 23.31799}
        );
        expect(d).toBeGreaterThan(1200);
        expect(d).toBeLessThan(1600);
    });
});
