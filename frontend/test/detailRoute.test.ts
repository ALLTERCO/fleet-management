import {describe, expect, it} from 'vitest';
import {
    alertInstanceRoute,
    parsePositiveRouteId
} from '../src/helpers/detailRoute';

describe('detail page ID handling', () => {
    it('accepts a single positive safe integer segment', () => {
        expect(parsePositiveRouteId('1')).toBe(1);
        expect(parsePositiveRouteId('2048')).toBe(2048);
        expect(parsePositiveRouteId(['15'])).toBe(15);
    });

    it.each([
        undefined,
        null,
        '',
        '0',
        '-3',
        '12junk',
        '1.5',
        ' 12',
        '01',
        '1e2',
        '9007199254740992',
        [],
        ['1', '2']
    ])('rejects malformed route ID %j', (value) => {
        expect(parsePositiveRouteId(value)).toBeNull();
    });
});

describe('alert instance deep-link', () => {
    it('opens the inbox query state instead of a non-existent detail route', () => {
        expect(alertInstanceRoute(42)).toEqual({
            path: '/alerts',
            query: {instance: '42'}
        });
    });
});
