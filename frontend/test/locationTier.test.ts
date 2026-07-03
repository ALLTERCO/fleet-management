import {describe, expect, it} from 'vitest';
import {tierForKind} from '@/helpers/location-tier';

describe('tierForKind', () => {
    it('groups geographic kinds into the geographic tier', () => {
        for (const k of [
            'continent',
            'country',
            'region',
            'county',
            'city',
            'neighborhood'
        ] as const) {
            expect(tierForKind(k)).toBe('geographic');
        }
    });

    it('groups campus and site into the site tier', () => {
        expect(tierForKind('campus')).toBe('site');
        expect(tierForKind('site')).toBe('site');
    });

    it('puts building on its own tier so it gets the 3D stack hero', () => {
        expect(tierForKind('building')).toBe('building');
    });

    it('groups every indoor kind (office, floor, area, room, zone) into indoor', () => {
        for (const k of ['office', 'floor', 'area', 'room', 'zone'] as const) {
            expect(tierForKind(k)).toBe('indoor');
        }
    });

    it('defaults null and undefined to geographic so an unknown row degrades safely', () => {
        expect(tierForKind(null)).toBe('geographic');
        expect(tierForKind(undefined)).toBe('geographic');
    });
});
