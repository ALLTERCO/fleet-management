import {describe, expect, it} from 'vitest';
import {
    type DeviceMembership,
    deviceMatchesScope,
    filterByScope
} from '@/helpers/dashboardScopeFilter';

function membership(over: Partial<DeviceMembership> = {}): DeviceMembership {
    return {
        groupIds: over.groupIds ?? [],
        tagIds: over.tagIds ?? [],
        locationId: over.locationId ?? null,
        shellyID: over.shellyID ?? 'shelly-1'
    };
}

describe('deviceMatchesScope', () => {
    it('passes everything when scope is fleet', () => {
        expect(deviceMatchesScope(membership(), {kind: 'fleet'})).toBe(true);
    });

    it('matches by group id', () => {
        const m = membership({groupIds: [1, 2, 3]});
        expect(deviceMatchesScope(m, {kind: 'group', id: 2})).toBe(true);
        expect(deviceMatchesScope(m, {kind: 'group', id: 9})).toBe(false);
    });

    it('matches by tag id', () => {
        const m = membership({tagIds: [7]});
        expect(deviceMatchesScope(m, {kind: 'tag', id: 7})).toBe(true);
        expect(deviceMatchesScope(m, {kind: 'tag', id: 8})).toBe(false);
    });

    it('matches by location id', () => {
        const m = membership({locationId: 42});
        expect(deviceMatchesScope(m, {kind: 'location', id: 42})).toBe(true);
        expect(deviceMatchesScope(m, {kind: 'location', id: 0})).toBe(false);
    });

    it('treats a scope with missing id as fleet (forward-compat)', () => {
        expect(deviceMatchesScope(membership(), {kind: 'group'})).toBe(true);
    });
});

describe('filterByScope', () => {
    const items = [
        {name: 'A', m: membership({groupIds: [1]})},
        {name: 'B', m: membership({groupIds: [2]})},
        {name: 'C', m: membership({groupIds: [1, 2]})}
    ];

    it('returns the input unchanged for fleet scope', () => {
        const out = filterByScope(items, (i) => i.m, {kind: 'fleet'});
        expect(out).toBe(items);
    });

    it('filters by group membership', () => {
        const out = filterByScope(items, (i) => i.m, {kind: 'group', id: 1});
        expect(out.map((i) => i.name)).toEqual(['A', 'C']);
    });

    it('drops items whose membership is null', () => {
        const withNull = [
            ...items,
            {name: 'D', m: null as unknown as DeviceMembership}
        ];
        const out = filterByScope(
            withNull,
            (i) => (i.name === 'D' ? null : i.m),
            {kind: 'group', id: 1}
        );
        expect(out.map((i) => i.name)).toEqual(['A', 'C']);
    });
});
