/** One rule per test for the spherical-circle polygon builder. */

import {describe, expect, it} from 'vitest';
import {circlePolygon} from '@/helpers/map-circle';

describe('circlePolygon', () => {
    it('returns a closed ring whose first and last vertex coincide', () => {
        const polygon = circlePolygon({
            center: {lat: 45, lng: 10},
            radiusMeters: 200
        });
        const ring = polygon.geometry.coordinates[0];
        expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('returns 65 vertices for the default 64 segments (n + 1 for closure)', () => {
        const polygon = circlePolygon({
            center: {lat: 0, lng: 0},
            radiusMeters: 1000
        });
        expect(polygon.geometry.coordinates[0]).toHaveLength(65);
    });

    it('respects an explicit segment count + closure rule', () => {
        const polygon = circlePolygon({
            center: {lat: 0, lng: 0},
            radiusMeters: 1000,
            segments: 32
        });
        expect(polygon.geometry.coordinates[0]).toHaveLength(33);
    });

    it('clamps a too-low segment count to the smooth-enough floor of 12', () => {
        const polygon = circlePolygon({
            center: {lat: 0, lng: 0},
            radiusMeters: 1000,
            segments: 3
        });
        expect(polygon.geometry.coordinates[0]).toHaveLength(13);
    });

    it('clamps a too-high segment count to the GPU-safe ceiling of 256', () => {
        const polygon = circlePolygon({
            center: {lat: 0, lng: 0},
            radiusMeters: 1000,
            segments: 10_000
        });
        expect(polygon.geometry.coordinates[0]).toHaveLength(257);
    });

    it('produces an east-west spread roughly equal to the radius at the equator', () => {
        const polygon = circlePolygon({
            center: {lat: 0, lng: 0},
            radiusMeters: 1000
        });
        const lngs = polygon.geometry.coordinates[0].map((p) => p[0]);
        const spreadMeters =
            ((Math.max(...lngs) - Math.min(...lngs)) / 2) *
            ((Math.PI / 180) * 6378137);
        expect(spreadMeters).toBeGreaterThan(900);
        expect(spreadMeters).toBeLessThan(1100);
    });

    it('shrinks the east-west spread at high latitudes (longitude squeeze)', () => {
        const equator = circlePolygon({
            center: {lat: 0, lng: 0},
            radiusMeters: 1000
        });
        const arctic = circlePolygon({
            center: {lat: 70, lng: 0},
            radiusMeters: 1000
        });
        const eqWidth =
            Math.max(...equator.geometry.coordinates[0].map((p) => p[0])) -
            Math.min(...equator.geometry.coordinates[0].map((p) => p[0]));
        const arcWidth =
            Math.max(...arctic.geometry.coordinates[0].map((p) => p[0])) -
            Math.min(...arctic.geometry.coordinates[0].map((p) => p[0]));
        expect(arcWidth).toBeGreaterThan(eqWidth);
    });
});
