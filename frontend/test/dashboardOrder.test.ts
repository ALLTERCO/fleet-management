import {beforeEach, describe, expect, it} from 'vitest';
import {
    DEFAULT_DASHBOARD_ID,
    isDefaultDashboard,
    persistDashboardOrder,
    purgeOrderedIds,
    readDashboardOrder,
    reorderById,
    toFiniteDashId
} from '@/helpers/dashboardOrder';

describe('readDashboardOrder', () => {
    beforeEach(() => localStorage.clear());

    it('returns an empty list when nothing is stored', () => {
        expect(readDashboardOrder()).toEqual([]);
    });

    it('reads back a previously persisted list', () => {
        persistDashboardOrder([1, 5, 3]);
        expect(readDashboardOrder()).toEqual([1, 5, 3]);
    });

    it('returns an empty list when storage is corrupt', () => {
        localStorage.setItem('fm-dashboard-order', '{not json');
        expect(readDashboardOrder()).toEqual([]);
    });
});

describe('reorderById', () => {
    it('moves an id up by one position', () => {
        expect(reorderById([1, 2, 3, 4], 3, -1)).toEqual([1, 3, 2, 4]);
    });

    it('moves an id down by one position', () => {
        expect(reorderById([1, 2, 3, 4], 2, 1)).toEqual([1, 3, 2, 4]);
    });

    it('returns the original list when the target would fall off the start', () => {
        const input = [1, 2, 3];
        expect(reorderById(input, 1, -1)).toBe(input);
    });

    it('returns the original list when the target would fall off the end', () => {
        const input = [1, 2, 3];
        expect(reorderById(input, 3, 1)).toBe(input);
    });

    it('matches string and number ids of equal value', () => {
        expect(reorderById([1, 2, 3], '2', 1)).toEqual([1, 3, 2]);
    });

    it('returns the original list when the id is missing', () => {
        const input = [1, 2, 3];
        expect(reorderById(input, 99, 1)).toBe(input);
    });
});

describe('purgeOrderedIds', () => {
    it('drops the listed ids', () => {
        expect(purgeOrderedIds([1, 2, 3, 4], [2, 4])).toEqual([1, 3]);
    });

    it('returns the input when nothing matches', () => {
        expect(purgeOrderedIds([1, 2, 3], [99])).toEqual([1, 2, 3]);
    });
});

describe('DEFAULT_DASHBOARD_ID', () => {
    it('matches the seed default in the schema', () => {
        expect(DEFAULT_DASHBOARD_ID).toBe(1);
    });
});

describe('toFiniteDashId', () => {
    it('accepts plain integer numbers', () => {
        expect(toFiniteDashId(1)).toBe(1);
        expect(toFiniteDashId(42)).toBe(42);
    });

    it('rejects non-integer numbers', () => {
        expect(toFiniteDashId(1.5)).toBeNull();
        expect(toFiniteDashId(Number.NaN)).toBeNull();
        expect(toFiniteDashId(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('accepts decimal-string integers', () => {
        expect(toFiniteDashId('1')).toBe(1);
        expect(toFiniteDashId('-7')).toBe(-7);
    });

    it('rejects hex, float, padded, and garbage strings', () => {
        expect(toFiniteDashId('0x1')).toBeNull();
        expect(toFiniteDashId('1.0')).toBeNull();
        expect(toFiniteDashId(' 1 ')).toBeNull();
        expect(toFiniteDashId('1e3')).toBeNull();
        expect(toFiniteDashId('abc')).toBeNull();
        expect(toFiniteDashId('')).toBeNull();
    });
});

describe('isDefaultDashboard', () => {
    it('returns true for the literal default id', () => {
        expect(isDefaultDashboard(1)).toBe(true);
        expect(isDefaultDashboard('1')).toBe(true);
    });

    it('is strict — does not coerce loose strings', () => {
        expect(isDefaultDashboard('0x1')).toBe(false);
        expect(isDefaultDashboard('1.0')).toBe(false);
        expect(isDefaultDashboard(' 1 ')).toBe(false);
        expect(isDefaultDashboard('one')).toBe(false);
    });
});
