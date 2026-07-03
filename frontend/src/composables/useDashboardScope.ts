// Global "scope filter" for dashboards: persisted per-user, observed by
// every domain page so a Group/Tag selection in the header narrows every
// chart to that subset. Mirrors the useDashboardOrder/useRecentDashboards
// singleton pattern.

import {computed, type MaybeRefOrGetter, type Ref, ref, toValue} from 'vue';

export type ScopeKind = 'fleet' | 'group' | 'tag' | 'location';

export interface DashboardScope {
    readonly kind: ScopeKind;
    readonly id?: number;
}

const STORAGE_PREFIX = 'fm-dashboard-scope';
const FLEET_SCOPE: DashboardScope = {kind: 'fleet'};

export interface UseDashboardScopeApi {
    readonly current: Ref<DashboardScope>;
    readonly setScope: (scope: DashboardScope) => void;
    readonly clearScope: () => void;
}

const cache = new Map<string, Ref<DashboardScope>>();

export function useDashboardScope(
    options: {
        scopeKey?: MaybeRefOrGetter<string | number | null | undefined>;
    } = {}
): UseDashboardScopeApi {
    const sessionKey = computed(() => normalize(toValue(options.scopeKey)));

    function bucket(): Ref<DashboardScope> {
        const key = sessionKey.value;
        const existing = cache.get(key);
        if (existing) return existing;
        const created = ref<DashboardScope>(readFromStorage(storageKey(key)));
        cache.set(key, created);
        return created;
    }

    const current = computed(() => bucket().value);

    return {
        current,
        setScope(scope) {
            const target = bucket();
            target.value = scope;
            writeToStorage(storageKey(sessionKey.value), scope);
        },
        clearScope() {
            const target = bucket();
            target.value = FLEET_SCOPE;
            writeToStorage(storageKey(sessionKey.value), FLEET_SCOPE);
        }
    };
}

function normalize(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return 'anon';
    const str = String(value);
    return str.length > 0 ? str : 'anon';
}

function storageKey(session: string): string {
    return `${STORAGE_PREFIX}:${session}`;
}

function readFromStorage(key: string): DashboardScope {
    if (typeof localStorage === 'undefined') return FLEET_SCOPE;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return FLEET_SCOPE;
        const parsed = JSON.parse(raw);
        return isScope(parsed) ? parsed : FLEET_SCOPE;
    } catch {
        return FLEET_SCOPE;
    }
}

function writeToStorage(key: string, scope: DashboardScope): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(scope));
    } catch {
        // Quota / private mode — drop.
    }
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

// Reject any scope whose id shape doesn't match its kind. localStorage is
// untrusted (older builds, hand edits, quota replays) so a corrupt entry
// must fall back to fleet rather than poison downstream filters.
function isScope(value: unknown): value is DashboardScope {
    if (typeof value !== 'object' || value === null) return false;
    const kind = (value as {kind?: unknown}).kind;
    const id = (value as {id?: unknown}).id;
    if (kind === 'fleet') return id === undefined;
    if (kind === 'group' || kind === 'tag' || kind === 'location') {
        return isPositiveInteger(id);
    }
    return false;
}

export function __resetDashboardScopeCacheForTests(): void {
    cache.clear();
}
