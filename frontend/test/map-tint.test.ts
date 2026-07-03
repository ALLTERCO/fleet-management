import type {LayerSpecification} from 'maplibre-gl';
import {describe, expect, it} from 'vitest';
import {lineColorFor, APPLE_MAPS_DARK_PALETTE as P} from '@/helpers/map-tint';

function line(
    id: string,
    sourceLayer?: string,
    filter?: unknown[]
): LayerSpecification {
    return {
        id,
        type: 'line',
        source: 'openmaptiles',
        ...(sourceLayer ? {'source-layer': sourceLayer} : {}),
        ...(filter ? {filter} : {})
    } as LayerSpecification;
}

describe('lineColorFor — pick the right palette slot per line layer', () => {
    it('paints a country admin line in the boundary-country slot so continents read at world zoom', () => {
        expect(lineColorFor(line('admin_country', 'boundary'))).toBe(
            P.boundaryCountry
        );
    });

    it('paints a state line in the boundary-state slot — subtle, never as bright as the country edge', () => {
        const layer = line('admin_state', 'boundary', [
            '==',
            ['get', 'admin_level'],
            4
        ]);
        expect(lineColorFor(layer)).toBe(P.boundaryState);
    });

    it('treats a region id like state because the keyword is enough signal even without an admin_level filter', () => {
        expect(lineColorFor(line('admin-region-2', 'boundary'))).toBe(
            P.boundaryState
        );
    });

    it('paints coastline lines with the lightest white tone so the edge sharpens without competing with country borders', () => {
        expect(lineColorFor(line('coastline'))).toBe(P.coastline);
    });

    it('promotes major arteries to road-major so motorways stand out from side streets', () => {
        expect(lineColorFor(line('road_motorway'))).toBe(P.roadMajor);
        expect(lineColorFor(line('highway-trunk'))).toBe(P.roadMajor);
    });

    it('keeps minor roads close to the basemap so the side-street mesh fades into the land color', () => {
        expect(lineColorFor(line('road_residential'))).toBe(P.roadMinor);
    });
});

describe('APPLE_MAPS_DARK_PALETTE — invariants we promise iOS 26 mimicry on', () => {
    it('keeps water darker than land so continents glow above the ocean instead of disappearing into it', () => {
        // Sum the rgb bytes: smaller sum = darker.
        const sum = (hex: string) => {
            const n = parseInt(hex.slice(1), 16);
            return ((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff);
        };
        expect(sum(P.water)).toBeLessThan(sum(P.land));
    });

    it('keeps building fill brighter than land so city blocks emerge at high zoom', () => {
        expect(P.building).not.toBe(P.land);
    });

    it('keeps the country boundary brighter than the state boundary so the hierarchy reads at a glance', () => {
        const alpha = (rgba: string) =>
            Number(rgba.match(/rgba?\([^)]*,\s*([\d.]+)\s*\)/)?.[1] ?? '0');
        expect(alpha(P.boundaryCountry)).toBeGreaterThan(
            alpha(P.boundaryState)
        );
    });
});
