import {beforeEach, describe, expect, it} from 'vitest';
import {
    __resetDashboardScopeCacheForTests,
    useDashboardScope
} from '@/composables/useDashboardScope';

describe('useDashboardScope', () => {
    beforeEach(() => {
        localStorage.clear();
        __resetDashboardScopeCacheForTests();
    });

    it('starts at fleet when no scope was previously set', () => {
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('persists set scope to localStorage', () => {
        const api = useDashboardScope({scopeKey: 'user-1'});
        api.setScope({kind: 'group', id: 7});
        expect(api.current.value).toEqual({kind: 'group', id: 7});
        const raw = localStorage.getItem('fm-dashboard-scope:user-1');
        expect(raw).toBeTruthy();
        expect(JSON.parse(raw ?? '{}')).toEqual({kind: 'group', id: 7});
    });

    it('clearScope returns to fleet', () => {
        const api = useDashboardScope({scopeKey: 'user-1'});
        api.setScope({kind: 'tag', id: 5});
        api.clearScope();
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('two callers share the same singleton bucket per scope key', () => {
        const a = useDashboardScope({scopeKey: 'user-1'});
        const b = useDashboardScope({scopeKey: 'user-1'});
        a.setScope({kind: 'group', id: 9});
        expect(b.current.value).toEqual({kind: 'group', id: 9});
    });

    it('different users get isolated scope buckets', () => {
        const a = useDashboardScope({scopeKey: 'user-1'});
        const b = useDashboardScope({scopeKey: 'user-2'});
        a.setScope({kind: 'group', id: 1});
        expect(b.current.value).toEqual({kind: 'fleet'});
    });

    it('rejects corrupt persisted shape — falls back to fleet', () => {
        localStorage.setItem('fm-dashboard-scope:user-1', '{"kind":"bogus"}');
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    // ── Input validation (regression) — localStorage is untrusted ──

    it('rejects a persisted group scope with a non-numeric id', () => {
        localStorage.setItem(
            'fm-dashboard-scope:user-1',
            '{"kind":"group","id":"evil"}'
        );
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('rejects a persisted group scope with id=0', () => {
        localStorage.setItem(
            'fm-dashboard-scope:user-1',
            '{"kind":"group","id":0}'
        );
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('rejects a persisted group scope with a negative id', () => {
        localStorage.setItem(
            'fm-dashboard-scope:user-1',
            '{"kind":"group","id":-3}'
        );
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('rejects a persisted group scope with a non-integer id', () => {
        localStorage.setItem(
            'fm-dashboard-scope:user-1',
            '{"kind":"group","id":1.5}'
        );
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('rejects a persisted fleet scope that smuggles an id', () => {
        localStorage.setItem(
            'fm-dashboard-scope:user-1',
            '{"kind":"fleet","id":7}'
        );
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });

    it('rejects unparseable JSON without throwing', () => {
        localStorage.setItem('fm-dashboard-scope:user-1', '{not json');
        const api = useDashboardScope({scopeKey: 'user-1'});
        expect(api.current.value).toEqual({kind: 'fleet'});
    });
});
