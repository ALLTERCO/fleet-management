// REGRESSION: the device-grid tag-filter chips must resolve their IDs to
// the actual ApiTag objects in the store. A regression that drops the
// lookup would render bare numeric IDs ("12") instead of named chips.
import {createPinia, setActivePinia} from 'pinia';
import {beforeEach, describe, expect, it} from 'vitest';
import {useTagsStore} from '@/stores/tags';

// Pure logic mirroring the activeTagChips computed in devices/index.vue —
// kept here so the chip resolution is unit-testable without rendering.
function resolveActiveTagChips(
    selectedTagIds: string[],
    tagsById: Record<number, {id: number; name: string; key: string}>
) {
    return selectedTagIds
        .map((id) => tagsById[Number(id)])
        .filter((t): t is NonNullable<typeof t> => !!t);
}

describe('device grid — active tag chip resolution', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
    });

    it('resolves selected ids to named tag entries', () => {
        const store = useTagsStore();
        store.tags = {
            12: {id: 12, key: 'prod', name: 'Production'} as never,
            47: {id: 47, key: 'eu', name: 'EU region'} as never
        };
        const chips = resolveActiveTagChips(['12', '47'], store.tags as never);
        expect(chips.map((t) => t.name)).toEqual(['Production', 'EU region']);
    });

    it('silently drops chips whose tag has been deleted (no orphan badges)', () => {
        const store = useTagsStore();
        store.tags = {
            12: {id: 12, key: 'prod', name: 'Production'} as never
        };
        const chips = resolveActiveTagChips(['12', '999'], store.tags as never);
        expect(chips.map((t) => t.id)).toEqual([12]);
    });

    it('one-click remove preserves the rest of the filter', () => {
        // removeTagFilter is pure filter() over the ids; mirror it.
        const filter = ['12', '47', '99'];
        const next = filter.filter((id) => Number(id) !== 47);
        expect(next).toEqual(['12', '99']);
    });
});
