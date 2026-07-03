import {describe, expect, it} from 'vitest';
import {
    computeFloorStackLayout,
    selectFloorsOfBuilding
} from '@/helpers/buildingFloorStack';
import type {ApiLocation, LocationKind} from '@/stores/locations';

function makeLocation(
    id: number,
    overrides: Partial<ApiLocation> = {}
): ApiLocation {
    return {
        id,
        organizationId: 'org',
        name: `loc-${id}`,
        kind: 'floor' as LocationKind,
        parentLocationId: 100,
        sortOrder: 0,
        kindFields: {},
        customFields: {},
        effective: {
            timezone: null,
            countryCode: null,
            currency: null,
            regulatoryZone: null,
            complianceTags: []
        },
        coordinateStatus: {state: 'missing_address', summary: ''},
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
        ...overrides
    };
}

describe('computeFloorStackLayout', () => {
    it('returns an empty layout for no floors', () => {
        const layout = computeFloorStackLayout({
            floors: [],
            options: {gapY: 1, planeSize: 10}
        });
        expect(layout.entries).toEqual([]);
        expect(layout.totalHeightY).toBe(0);
    });

    it('places floors at Y = order × gap, starting from 0', () => {
        const layout = computeFloorStackLayout({
            floors: [
                makeLocation(1, {sortOrder: 0, name: 'Ground'}),
                makeLocation(2, {sortOrder: 1, name: 'First'}),
                makeLocation(3, {sortOrder: 2, name: 'Second'})
            ],
            options: {gapY: 4, planeSize: 10}
        });
        expect(layout.entries.map((e) => e.y)).toEqual([0, 4, 8]);
        expect(layout.entries.map((e) => e.order)).toEqual([0, 1, 2]);
    });

    it('sorts by sortOrder ascending (ground floor first)', () => {
        const layout = computeFloorStackLayout({
            floors: [
                makeLocation(3, {sortOrder: 2, name: 'C'}),
                makeLocation(1, {sortOrder: 0, name: 'A'}),
                makeLocation(2, {sortOrder: 1, name: 'B'})
            ],
            options: {gapY: 1, planeSize: 10}
        });
        expect(layout.entries.map((e) => e.id)).toEqual([1, 2, 3]);
    });

    it('breaks sortOrder ties by name to keep output deterministic', () => {
        const layout = computeFloorStackLayout({
            floors: [
                makeLocation(1, {sortOrder: 0, name: 'B'}),
                makeLocation(2, {sortOrder: 0, name: 'A'})
            ],
            options: {gapY: 1, planeSize: 10}
        });
        expect(layout.entries.map((e) => e.name)).toEqual(['A', 'B']);
    });

    it('exposes the total height for camera framing', () => {
        const layout = computeFloorStackLayout({
            floors: [
                makeLocation(1, {sortOrder: 0}),
                makeLocation(2, {sortOrder: 1})
            ],
            options: {gapY: 3, planeSize: 8}
        });
        // top entry sits at y=3; plane half-size is 4; total = 7.
        expect(layout.totalHeightY).toBe(7);
    });
});

describe('computeFloorStackLayout — input validation', () => {
    it('rejects zero or negative gapY', () => {
        expect(() =>
            computeFloorStackLayout({
                floors: [],
                options: {gapY: 0, planeSize: 10}
            })
        ).toThrow(RangeError);
        expect(() =>
            computeFloorStackLayout({
                floors: [],
                options: {gapY: -1, planeSize: 10}
            })
        ).toThrow(RangeError);
    });

    it('rejects zero or negative planeSize', () => {
        expect(() =>
            computeFloorStackLayout({
                floors: [],
                options: {gapY: 1, planeSize: 0}
            })
        ).toThrow(RangeError);
        expect(() =>
            computeFloorStackLayout({
                floors: [],
                options: {gapY: 1, planeSize: -10}
            })
        ).toThrow(RangeError);
    });

    it('rejects non-finite numbers (NaN, Infinity)', () => {
        expect(() =>
            computeFloorStackLayout({
                floors: [],
                options: {gapY: Number.NaN, planeSize: 10}
            })
        ).toThrow(RangeError);
        expect(() =>
            computeFloorStackLayout({
                floors: [],
                options: {gapY: 1, planeSize: Number.POSITIVE_INFINITY}
            })
        ).toThrow(RangeError);
    });
});

describe('selectFloorsOfBuilding', () => {
    it('returns only the direct child floors of the given building', () => {
        const building = makeLocation(100, {
            kind: 'building',
            parentLocationId: null,
            sortOrder: 0
        });
        const floors = [
            makeLocation(1, {parentLocationId: 100, sortOrder: 0}),
            makeLocation(2, {parentLocationId: 100, sortOrder: 1}),
            makeLocation(3, {parentLocationId: 999, sortOrder: 0}) // other building
        ];
        const other = makeLocation(20, {
            parentLocationId: 100,
            kind: 'office'
        });
        const locations: Record<number, ApiLocation> = {
            [building.id]: building,
            [other.id]: other
        };
        for (const f of floors) locations[f.id] = f;

        const result = selectFloorsOfBuilding({
            buildingId: 100,
            locations
        });
        expect(result.map((f) => f.id).sort()).toEqual([1, 2]);
    });

    it('returns an empty list when the building has no floor children', () => {
        const result = selectFloorsOfBuilding({
            buildingId: 100,
            locations: {
                100: makeLocation(100, {
                    kind: 'building',
                    parentLocationId: null
                })
            }
        });
        expect(result).toEqual([]);
    });
});
