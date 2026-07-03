import {effectScope, nextTick, ref} from 'vue';
import {describe, expect, it} from 'vitest';
import {useReactiveListSource} from '@/composables/useReactiveListSource';

describe('useReactiveListSource', () => {
    it('windows reactive items and preserves the loaded window on mutation', async () => {
        const source = ref([1, 2, 3, 4]);
        const scope = effectScope();
        const list = scope.run(() =>
            useReactiveListSource(source, {pageSize: 2})
        );

        expect(list).toBeDefined();
        if (!list) throw new Error('list source not created');

        expect(list.pageItems.value).toEqual([1, 2]);
        expect(list.hasMore.value).toBe(true);

        await list.loadMore();
        expect(list.pageItems.value).toEqual([1, 2, 3, 4]);
        expect(list.hasMore.value).toBe(false);

        source.value = [10, 20, 30, 40, 50];
        source.value = [100, 200, 300, 400, 500];
        await nextTick();
        await nextTick();

        expect(list.pageItems.value).toEqual([100, 200, 300, 400]);
        expect(list.hasMore.value).toBe(true);
        scope.stop();
    });

    it('loadMore is a no-op once everything is visible', async () => {
        const source = ref([1, 2, 3]);
        const scope = effectScope();
        const list = scope.run(() =>
            useReactiveListSource(source, {pageSize: 10})
        );
        if (!list) throw new Error('list source not created');

        expect(list.pageItems.value).toEqual([1, 2, 3]);
        expect(list.hasMore.value).toBe(false);

        await list.loadMore();
        await list.loadMore();
        expect(list.pageItems.value).toEqual([1, 2, 3]);
        scope.stop();
    });

    it('pages mode slices by page * pageSize and respects goToPage', async () => {
        const source = ref([1, 2, 3, 4, 5, 6, 7]);
        const scope = effectScope();
        const list = scope.run(() =>
            useReactiveListSource(source, {pageSize: 3, mode: 'pages'})
        );
        if (!list) throw new Error('list source not created');

        expect(list.pageItems.value).toEqual([1, 2, 3]);
        expect(list.pageCount.value).toBe(3);

        list.goToPage(2);
        await nextTick();
        await nextTick();
        expect(list.pageItems.value).toEqual([4, 5, 6]);

        list.goToPage(99);
        await nextTick();
        await nextTick();
        expect(list.page.value).toBe(3);
        expect(list.pageItems.value).toEqual([7]);
        scope.stop();
    });

    it('setPageSize re-slices the current page', async () => {
        const source = ref([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        const scope = effectScope();
        const list = scope.run(() =>
            useReactiveListSource(source, {pageSize: 2, mode: 'pages'})
        );
        if (!list) throw new Error('list source not created');

        expect(list.pageItems.value).toEqual([1, 2]);
        list.setPageSize(5);
        await nextTick();
        await nextTick();
        expect(list.pageItems.value).toEqual([1, 2, 3, 4, 5]);
        expect(list.pageCount.value).toBe(2);
        scope.stop();
    });
});
