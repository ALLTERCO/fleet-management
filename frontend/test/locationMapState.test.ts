import type {Location as ApiLocation} from '@api/location';
import {describe, expect, it} from 'vitest';
import type {LocationHealth} from '@/composables/useLocationStatus';
import {locationMapState} from '@/helpers/locationMapState';

describe('locationMapState', () => {
    it('promotes per-location health into pin status when provided', () => {
        const health = new Map<number, LocationHealth>([
            [1, {total: 4, online: 2, status: 'warn'}]
        ]);
        const state = locationMapState(
            [
                location({
                    id: 1,
                    name: 'HQ',
                    kindFields: {geo: {lat: 42.7, lng: 23.3}}
                })
            ],
            health
        );
        expect(state.pins[0].status).toBe('warn');
    });

    it('attaches alertCount only when the alert map reports a non-zero count', () => {
        const alerts = new Map<number, number>([[1, 3]]);
        const state = locationMapState(
            [
                location({
                    id: 1,
                    name: 'HQ',
                    kindFields: {geo: {lat: 42.7, lng: 23.3}}
                }),
                location({
                    id: 2,
                    name: 'Quiet',
                    kindFields: {geo: {lat: 41, lng: 2}}
                })
            ],
            undefined,
            alerts
        );
        expect(state.pins[0].alertCount).toBe(3);
        expect(state.pins[1].alertCount).toBeUndefined();
    });

    it('separates mapped pins from address-only locations', () => {
        const state = locationMapState([
            location({
                id: 1,
                name: 'HQ',
                kindFields: {geo: {lat: 42.7, lng: 23.3}}
            }),
            location({
                id: 2,
                name: 'Sofia Office',
                kindFields: {address: {city: 'Sofia', countryCode: 'BG'}}
            }),
            location({
                id: 3,
                name: 'Broken Geo',
                kindFields: {
                    geo: {lat: Number.NaN, lng: 23.3},
                    address: {city: 'Plovdiv'}
                }
            })
        ]);

        expect(state.pins).toEqual([
            {id: '1', lat: 42.7, lng: 23.3, label: 'HQ', kind: 'site'}
        ]);
        expect(state.unmapped).toEqual([
            {id: 2, name: 'Sofia Office', summary: 'Sofia, BG'},
            {id: 3, name: 'Broken Geo', summary: 'Plovdiv'}
        ]);
    });
});

function location(overrides: Partial<ApiLocation>): ApiLocation {
    return {
        id: 1,
        organizationId: 'org-1',
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
        createdAt: '2026-05-23T00:00:00.000Z',
        updatedAt: null,
        ...overrides
    };
}
