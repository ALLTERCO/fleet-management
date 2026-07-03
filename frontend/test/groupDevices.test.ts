import {describe, expect, it} from 'vitest';
import {shellyIdsFromGroups} from '@/helpers/groupDevices';

describe('shellyIdsFromGroups — union of devices across selected groups', () => {
    it('returns one set with every device id from each requested group so callers can membership-check in O(1)', () => {
        const groups = {
            1: {devices: ['a', 'b']},
            2: {devices: ['b', 'c']}
        };
        const result = shellyIdsFromGroups([1, 2], groups);
        expect([...result].sort()).toEqual(['a', 'b', 'c']);
    });

    it('skips ids the store has not loaded yet so a sparse selection does not throw', () => {
        const groups = {1: {devices: ['a']}};
        const result = shellyIdsFromGroups([1, 99], groups);
        expect([...result]).toEqual(['a']);
    });

    it('returns an empty set for no groups so callers can use the same shape for the unfiltered case', () => {
        const result = shellyIdsFromGroups([], {});
        expect(result.size).toBe(0);
    });
});
