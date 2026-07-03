import {beforeEach, describe, expect, it} from 'vitest';
import {ref} from 'vue';
import {
    __resetRecentDashboardsCacheForTests,
    dropRecentDashboardsScope,
    useRecentDashboards
} from '@/composables/useRecentDashboards';
import {pushRecent, removeRecent} from '@/helpers/recentDashboards';

const SCOPE = 'test';
const STORAGE_KEY = `fm-dashboard-recents:${SCOPE}`;

describe('pushRecent', () => {
    it('inserts a new id at the head', () => {
        expect(pushRecent([], 7)).toEqual([7]);
    });

    it('moves an existing id to the head without duplicating', () => {
        expect(pushRecent([3, 2, 1], 2)).toEqual([2, 3, 1]);
    });

    it('treats numeric and string ids that compare equal as the same row', () => {
        expect(pushRecent([3, '2', 1], 2)).toEqual([2, 3, 1]);
    });

    it('caps the resulting list at the limit', () => {
        expect(pushRecent([3, 2, 1], 4, 3)).toEqual([4, 3, 2]);
    });

    it('returns an empty list when the limit is zero', () => {
        expect(pushRecent([1, 2, 3], 4, 0)).toEqual([]);
    });

    it('does not mutate the input list', () => {
        const input = [1, 2, 3];
        pushRecent(input, 99);
        expect(input).toEqual([1, 2, 3]);
    });
});

describe('removeRecent', () => {
    it('drops the matching id', () => {
        expect(removeRecent([1, 2, 3], 2)).toEqual([1, 3]);
    });

    it('treats numeric/string ids as equal when removing', () => {
        expect(removeRecent([1, 2, 3], '2')).toEqual([1, 3]);
    });

    it('returns an equal list when the id is not present', () => {
        expect(removeRecent([1, 2, 3], 99)).toEqual([1, 2, 3]);
    });
});

describe('useRecentDashboards', () => {
    beforeEach(() => {
        localStorage.clear();
        __resetRecentDashboardsCacheForTests();
    });

    it('starts empty when storage is empty', () => {
        const api = useRecentDashboards({scopeKey: SCOPE});
        expect(api.ids.value).toEqual([]);
    });

    it('persists touched ids to a scoped localStorage key', () => {
        const api = useRecentDashboards({scopeKey: SCOPE});
        api.touch(7);
        api.touch(3);
        expect(api.ids.value).toEqual([3, 7]);
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
        expect(stored).toEqual([3, 7]);
    });

    it('reads the persisted list on first use', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([9, 8]));
        const api = useRecentDashboards({scopeKey: SCOPE});
        expect(api.ids.value).toEqual([9, 8]);
    });

    it('forgets the supplied id', () => {
        const api = useRecentDashboards({scopeKey: SCOPE});
        api.touch(1);
        api.touch(2);
        api.forget(1);
        expect(api.ids.value).toEqual([2]);
    });

    it('clears the entire list', () => {
        const api = useRecentDashboards({scopeKey: SCOPE});
        api.touch(1);
        api.touch(2);
        api.clear();
        expect(api.ids.value).toEqual([]);
    });

    it('survives corrupt storage by treating it as empty', () => {
        localStorage.setItem(STORAGE_KEY, '{not json');
        const api = useRecentDashboards({scopeKey: SCOPE});
        expect(api.ids.value).toEqual([]);
    });

    it('keeps separate lists per scope (user/org switch)', () => {
        const userA = useRecentDashboards({scopeKey: 'user-a'});
        const userB = useRecentDashboards({scopeKey: 'user-b'});
        userA.touch(1);
        userB.touch(99);
        expect(userA.ids.value).toEqual([1]);
        expect(userB.ids.value).toEqual([99]);
    });

    it('drops a single scope from the cache without affecting others', () => {
        const userA = useRecentDashboards({scopeKey: 'user-a'});
        const userB = useRecentDashboards({scopeKey: 'user-b'});
        userA.touch(1);
        userB.touch(99);
        dropRecentDashboardsScope('user-a');
        const userARefreshed = useRecentDashboards({scopeKey: 'user-a'});
        // Storage still has it, so refresh reads it back.
        expect(userARefreshed.ids.value).toEqual([1]);
        expect(userB.ids.value).toEqual([99]);
    });

    it('switches buckets when the scope key changes after mount', () => {
        const scope = ref<string | null>(null);
        const api = useRecentDashboards({scopeKey: () => scope.value});
        api.touch(7); // lands on the anon bucket
        expect(api.ids.value).toEqual([7]);

        scope.value = 'user-x';
        // Now reading the user-x bucket — fresh and empty.
        expect(api.ids.value).toEqual([]);

        api.touch(42); // lands on user-x
        expect(api.ids.value).toEqual([42]);

        scope.value = null; // back to anon — still has 7
        expect(api.ids.value).toEqual([7]);
    });

    it('treats empty / missing scope key as anon', () => {
        const empty = useRecentDashboards({scopeKey: ''});
        const undef = useRecentDashboards({});
        empty.touch(5);
        expect(undef.ids.value).toEqual([5]);
    });
});
