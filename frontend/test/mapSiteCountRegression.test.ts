import type {Location as ApiLocation} from '@api/location';
import {describe, expect, it} from 'vitest';
import {__testing as pulseTesting} from '@/composables/useFleetPulse';
import type {LocationHealth} from '@/composables/useLocationStatus';
import {__testing as panelTesting} from '@/composables/useSitePanelRows';

const {countSiteTotals} = pulseTesting;
const {buildSitePanelRows} = panelTesting;

function location(overrides: Partial<ApiLocation>): ApiLocation {
    return {
        id: 1,
        organizationId: 'org-test',
        name: 'Location',
        kind: 'site',
        parentLocationId: null,
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
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: null,
        ...overrides
    };
}

describe('REGRESSION: map site counts exclude child buildings', () => {
    const locations = [
        location({id: 1, name: 'Site A'}),
        location({id: 2, name: 'Site B'}),
        location({id: 11, kind: 'building', name: 'Building A', parentLocationId: 1}),
        location({id: 12, kind: 'building', name: 'Building B', parentLocationId: 2})
    ];
    const health = new Map<number, LocationHealth>([
        [1, {total: 4, online: 4, status: 'on'}],
        [2, {total: 3, online: 1, status: 'warn'}],
        [11, {total: 2, online: 2, status: 'on'}],
        [12, {total: 2, online: 2, status: 'on'}]
    ]);

    it('counts only the two site roots in the fleet pulse', () => {
        expect(countSiteTotals(locations, health)).toEqual({online: 1, total: 2});
    });

    it('shows only the two site roots in the map side panel', () => {
        const rows = buildSitePanelRows(locations, health, new Map());
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.id).sort((a, b) => a - b)).toEqual([1, 2]);
    });
});
