// What this person opened from the search and what they typed, so the overlay
// has something to show before a single key is pressed.

import {defineStore} from 'pinia';
import {computed, ref, watch} from 'vue';
import {moveToFront} from '@/helpers/recentList';
import {useAuthStore} from '@/stores/auth';

export interface RecentSearchItem {
    /** The results own the vocabulary of kinds; recents stores what it is given. */
    kind: string;
    id: string | number;
    label: string;
    route: string;
    /** The route leaves the app, so it wants a new tab. Kept on the item
     *  because the live results are free to stop offering the page. */
    external?: boolean;
}

interface Recents {
    items: readonly RecentSearchItem[];
    queries: readonly string[];
}

/** Long enough to be useful, short enough to read without scrolling. */
export const RECENT_ITEM_LIMIT = 8;
export const RECENT_QUERY_LIMIT = 5;

const STORAGE_PREFIX = 'fm-search-recents';
const ANONYMOUS_USER = 'anon';
const NOTHING: Recents = {items: [], queries: []};

function storageKeyFor(userId: string): string {
    return `${STORAGE_PREFIX}:${userId}`;
}

/** Signed out, everyone shares one bucket that no account can read. */
function scopeFor(userId: string | null | undefined): string {
    return userId ? userId : ANONYMOUS_USER;
}

function itemIdentity(item: RecentSearchItem): string {
    return `${item.kind}:${item.id}`;
}

/** Typing the same word in a different case is the same search. */
function queryIdentity(query: string): string {
    return query.toLowerCase();
}

function isRecentItem(value: unknown): value is RecentSearchItem {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Record<string, unknown>;
    return (
        typeof item.kind === 'string' &&
        (typeof item.id === 'string' || typeof item.id === 'number') &&
        typeof item.label === 'string' &&
        typeof item.route === 'string' &&
        (item.external === undefined || typeof item.external === 'boolean')
    );
}

function storedItems(value: unknown): readonly RecentSearchItem[] {
    return Array.isArray(value) ? value.filter(isRecentItem) : [];
}

function storedQueries(value: unknown): readonly string[] {
    return Array.isArray(value)
        ? value.filter((query) => typeof query === 'string')
        : [];
}

function toRecents(value: unknown): Recents {
    if (typeof value !== 'object' || value === null) return NOTHING;
    const stored = value as Record<string, unknown>;
    return {
        items: storedItems(stored.items),
        queries: storedQueries(stored.queries)
    };
}

// A half-written value, or a browser with storage switched off, must still
// leave the search usable: an empty history is the honest answer to both.
function readStored(storageKey: string): Recents {
    try {
        const raw = localStorage.getItem(storageKey);
        return raw === null ? NOTHING : toRecents(JSON.parse(raw));
    } catch {
        return NOTHING;
    }
}

// Same reason: a person whose browser refuses to save still gets the list for
// as long as the page is open.
function writeStored(storageKey: string, recents: Recents): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(recents));
    } catch {
        return;
    }
}

export const useSearchRecentsStore = defineStore('searchRecents', () => {
    const auth = useAuthStore();
    const scope = computed(() => scopeFor(auth.currentUserId));
    const recents = ref<Recents>(NOTHING);

    // Two people on one machine each get their own history, and the switch has
    // to land before the next read, so this watcher runs synchronously.
    watch(
        scope,
        (userScope) => {
            recents.value = readStored(storageKeyFor(userScope));
        },
        {immediate: true, flush: 'sync'}
    );

    function commit(next: Recents): void {
        recents.value = next;
        writeStored(storageKeyFor(scope.value), next);
    }

    function rememberOpened(item: RecentSearchItem): void {
        commit({
            ...recents.value,
            items: moveToFront({
                list: recents.value.items,
                entry: item,
                identify: itemIdentity,
                limit: RECENT_ITEM_LIMIT
            })
        });
    }

    function rememberQuery(text: string): void {
        const typed = text.trim();
        // Nothing was searched for, so there is nothing to offer back.
        if (typed.length === 0) return;
        commit({
            ...recents.value,
            queries: moveToFront({
                list: recents.value.queries,
                entry: typed,
                identify: queryIdentity,
                limit: RECENT_QUERY_LIMIT
            })
        });
    }

    /** Wipes this person's search history, here and in the browser. */
    function clearRecents(): void {
        commit(NOTHING);
    }

    return {
        recentItems: computed(() => recents.value.items),
        recentQueries: computed(() => recents.value.queries),
        rememberOpened,
        rememberQuery,
        clearRecents
    };
});
