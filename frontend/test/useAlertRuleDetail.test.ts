import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ref} from 'vue';

const store = vi.hoisted(() => ({
    listFirings: vi.fn(),
    previewRule: vi.fn()
}));
vi.mock('@/stores/alerts', () => ({useAlertsStore: () => store}));
vi.mock('@/config/ui', () => ({UI_CONFIG: {firingsPageSize: 2}}));

import {useAlertRuleDetail} from '@/composables/useAlertRuleDetail';

function firing(id: string) {
    return {transitionId: id} as never;
}

describe('useAlertRuleDetail', () => {
    beforeEach(() => {
        store.listFirings.mockReset();
        store.previewRule.mockReset();
    });

    it('loadFirings replaces from offset 0 and tracks total + more', async () => {
        store.listFirings.mockResolvedValue({
            items: [firing('a'), firing('b')],
            total: 5,
            has_more: true
        });
        const {firings, firingsTotal, hasMoreFirings, loadFirings} =
            useAlertRuleDetail(ref(7));

        await loadFirings();

        expect(store.listFirings).toHaveBeenCalledWith(7, 2, 0);
        expect(firings.value).toHaveLength(2);
        expect(firingsTotal.value).toBe(5);
        expect(hasMoreFirings.value).toBe(true);
    });

    it('loadMoreFirings appends at the current offset', async () => {
        store.listFirings
            .mockResolvedValueOnce({
                items: [firing('a'), firing('b')],
                total: 4,
                has_more: true
            })
            .mockResolvedValueOnce({
                items: [firing('c'), firing('d')],
                total: 4,
                has_more: false
            });
        const {firings, hasMoreFirings, loadFirings, loadMoreFirings} =
            useAlertRuleDetail(ref(7));

        await loadFirings();
        await loadMoreFirings();

        expect(store.listFirings).toHaveBeenLastCalledWith(7, 2, 2);
        expect(firings.value.map((f) => f.transitionId)).toEqual([
            'a',
            'b',
            'c',
            'd'
        ]);
        expect(hasMoreFirings.value).toBe(false);
    });

    it('does nothing when the rule id is null', async () => {
        const {loadFirings, runPreview} = useAlertRuleDetail(ref(null));
        await loadFirings();
        await runPreview();
        expect(store.listFirings).not.toHaveBeenCalled();
        expect(store.previewRule).not.toHaveBeenCalled();
    });

    it('runPreview stores the result and clears the running flag', async () => {
        store.previewRule.mockResolvedValue({
            matches: [],
            scanned: 3,
            supportedKind: true,
            truncated: false,
            note: null
        });
        const {previewResult, previewRunning, runPreview} = useAlertRuleDetail(
            ref(9)
        );

        await runPreview();

        expect(store.previewRule).toHaveBeenCalledWith({ruleId: 9});
        expect(previewResult.value?.scanned).toBe(3);
        expect(previewRunning.value).toBe(false);
    });

    it('reset clears firings and preview', async () => {
        store.listFirings.mockResolvedValue({
            items: [firing('a')],
            total: 1,
            has_more: false
        });
        const {firings, firingsTotal, previewResult, loadFirings, reset} =
            useAlertRuleDetail(ref(7));
        await loadFirings();

        reset();

        expect(firings.value).toHaveLength(0);
        expect(firingsTotal.value).toBeNull();
        expect(previewResult.value).toBeNull();
    });
});
