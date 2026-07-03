import {describe, expect, it} from 'vitest';
import {chunkBy, deviceMembers, diffMembers} from '@/helpers/groupMembers';

describe('deviceMembers', () => {
    it('maps shellyIDs to GroupMemberRef with subjectType: device', () => {
        expect(deviceMembers(['a', 'b'])).toEqual([
            {subjectType: 'device', subjectId: 'a'},
            {subjectType: 'device', subjectId: 'b'}
        ]);
    });

    it('empty input yields empty output', () => {
        expect(deviceMembers([])).toEqual([]);
    });
});

describe('chunkBy', () => {
    it('splits exact-multiple arrays evenly', () => {
        expect(chunkBy([1, 2, 3, 4, 5, 6], 2)).toEqual([
            [1, 2],
            [3, 4],
            [5, 6]
        ]);
    });

    it('last chunk is smaller when length is not a multiple', () => {
        expect(chunkBy([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it('returns single chunk when items.length < size', () => {
        expect(chunkBy([1, 2], 10)).toEqual([[1, 2]]);
    });

    it('returns empty array for empty input', () => {
        expect(chunkBy([], 5)).toEqual([]);
    });

    it('handles size === 1', () => {
        expect(chunkBy(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
    });

    it('groups 501 items into 2 chunks at size 500', () => {
        const items = Array.from({length: 501}, (_, i) => i);
        const chunks = chunkBy(items, 500);
        expect(chunks.length).toBe(2);
        expect(chunks[0].length).toBe(500);
        expect(chunks[1].length).toBe(1);
    });
});

describe('diffMembers', () => {
    it('reports pure additions', () => {
        expect(diffMembers([], ['a', 'b'])).toEqual({
            toAdd: ['a', 'b'],
            toRemove: []
        });
    });

    it('reports pure removals', () => {
        expect(diffMembers(['a', 'b'], [])).toEqual({
            toAdd: [],
            toRemove: ['a', 'b']
        });
    });

    it('ignores unchanged items', () => {
        expect(diffMembers(['a', 'b'], ['a', 'b'])).toEqual({
            toAdd: [],
            toRemove: []
        });
    });

    it('detects mixed add + remove', () => {
        expect(diffMembers(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({
            toAdd: ['d'],
            toRemove: ['a']
        });
    });

    it('deduplicates within each input', () => {
        // Baseline of duplicates should not produce duplicate removals
        expect(diffMembers(['a', 'a', 'b'], [])).toEqual({
            toAdd: [],
            toRemove: ['a', 'b']
        });
    });

    it('preserves target order in toAdd', () => {
        expect(diffMembers([], ['c', 'a', 'b'])).toEqual({
            toAdd: ['c', 'a', 'b'],
            toRemove: []
        });
    });
});
