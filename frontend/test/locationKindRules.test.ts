import {describe, expect, it} from 'vitest';
import {childKindFor} from '@/helpers/locationKindRules';

describe('childKindFor', () => {
    it('drills geographic parents downward', () => {
        expect(childKindFor('continent')).toBe('country');
        expect(childKindFor('country')).toBe('region');
        expect(childKindFor('region')).toBe('city');
    });

    it('walks city → site → building → floor → room', () => {
        expect(childKindFor('city')).toBe('site');
        expect(childKindFor('site')).toBe('building');
        expect(childKindFor('building')).toBe('floor');
        expect(childKindFor('floor')).toBe('room');
    });

    it('keeps campus consistent with site (both produce building children)', () => {
        expect(childKindFor('campus')).toBe('building');
    });

    it('falls back to site for kinds with no explicit mapping (zone is a leaf)', () => {
        expect(childKindFor('zone')).toBe('site');
    });

    it('returns a valid LocationKind for every defined parent', () => {
        const parents = [
            'continent',
            'country',
            'region',
            'city',
            'campus',
            'site',
            'building',
            'office',
            'floor',
            'area',
            'room'
        ] as const;
        for (const parent of parents) {
            expect(typeof childKindFor(parent)).toBe('string');
        }
    });
});
