import {computed, type MaybeRefOrGetter, type Ref, ref, toValue} from 'vue';
import {
    type DashboardId,
    pushRecent,
    removeRecent
} from '@/helpers/recentDashboards';

const STORAGE_PREFIX = 'fm-dashboard-recents';
const DEFAULT_LIMIT = 8;
const ANON_SCOPE = 'anon';

export interface UseRecentDashboardsApi {
    readonly ids: Ref<readonly DashboardId[]>;
    readonly touch: (id: DashboardId) => void;
    readonly forget: (id: DashboardId) => void;
    readonly clear: () => void;
}

// Per-scope singleton refs so user/org switches never share recents.
const cache = new Map<string, Ref<readonly DashboardId[]>>();

export function useRecentDashboards(
    options: {
        scopeKey?: MaybeRefOrGetter<string | number | null | undefined>;
        limit?: number;
    } = {}
): UseRecentDashboardsApi {
    const limit = options.limit ?? DEFAULT_LIMIT;
    const scope = computed(() => normalizeScope(toValue(options.scopeKey)));

    function bucket(): Ref<readonly DashboardId[]> {
        const key = scope.value;
        const existing = cache.get(key);
        if (existing) return existing;
        const created = ref<readonly DashboardId[]>(
            readFromStorage(storageKeyFor(key))
        );
        cache.set(key, created);
        return created;
    }

    const ids = computed(() => bucket().value);

    return {
        ids,
        touch(id) {
            const target = bucket();
            commit(
                target,
                storageKeyFor(scope.value),
                pushRecent(target.value, id, limit)
            );
        },
        forget(id) {
            const target = bucket();
            commit(
                target,
                storageKeyFor(scope.value),
                removeRecent(target.value, id)
            );
        },
        clear() {
            const target = bucket();
            commit(target, storageKeyFor(scope.value), []);
        }
    };
}

export function dropRecentDashboardsScope(
    scopeKey: string | number | null | undefined
): void {
    cache.delete(normalizeScope(scopeKey));
}

function normalizeScope(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return ANON_SCOPE;
    const str = String(value);
    return str.length > 0 ? str : ANON_SCOPE;
}

function commit(
    ref: Ref<readonly DashboardId[]>,
    storageKey: string,
    next: readonly DashboardId[]
): void {
    ref.value = next;
    writeToStorage(storageKey, next);
}

function storageKeyFor(scope: string): string {
    return `${STORAGE_PREFIX}:${scope}`;
}

function readFromStorage(storageKey: string): readonly DashboardId[] {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeToStorage(storageKey: string, ids: readonly DashboardId[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(storageKey, JSON.stringify(ids));
    } catch {
        // Storage quota or private mode — drop.
    }
}

export function __resetRecentDashboardsCacheForTests(): void {
    cache.clear();
}
