import {beforeEach, describe, expect, it} from 'vitest';
import {
    __resetDashboardOrderCacheForTests,
    useDashboardOrder
} from '@/composables/useDashboardOrder';

describe('useDashboardOrder', () => {
    beforeEach(() => {
        localStorage.clear();
        __resetDashboardOrderCacheForTests();
    });

    it('seeds from localStorage on first use', () => {
        localStorage.setItem('fm-dashboard-order', JSON.stringify([3, 1, 2]));
        expect(useDashboardOrder().ids.value).toEqual([3, 1, 2]);
    });

    it('move uses visibleIds when the persisted order is empty', () => {
        const api = useDashboardOrder();
        api.move([1, 2, 3], 2, -1);
        expect(api.ids.value).toEqual([2, 1, 3]);
    });

    it('move uses the persisted order once it exists, ignoring visibleIds', () => {
        const api = useDashboardOrder();
        api.replace([1, 2, 3]);
        api.move([99, 98, 97], 3, -1);
        expect(api.ids.value).toEqual([1, 3, 2]);
    });

    it('purge drops listed ids and writes to storage', () => {
        const api = useDashboardOrder();
        api.replace([1, 2, 3, 4]);
        api.purge([2, 4]);
        expect(api.ids.value).toEqual([1, 3]);
        expect(
            JSON.parse(localStorage.getItem('fm-dashboard-order') ?? '[]')
        ).toEqual([1, 3]);
    });

    it('regression: two callers see the same updates without remounting', () => {
        const a = useDashboardOrder();
        const b = useDashboardOrder();
        a.replace([10, 20]);
        expect(b.ids.value).toEqual([10, 20]);
        b.move([10, 20], 20, -1);
        expect(a.ids.value).toEqual([20, 10]);
    });
});
