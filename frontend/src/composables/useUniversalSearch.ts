// Shared logic behind the universal search pill. One instance per page —
// owns query state, runs the page-scope filter AND the cross-app scan,
// exposes keyboard nav over the flattened result list.

import Fuse, {type IFuseOptions} from 'fuse.js';
import {computed, type MaybeRefOrGetter, ref, toValue} from 'vue';
import {UI_CONFIG} from '@/config/ui';
import {
    buildSearchSources,
    type SearchHit,
    type SearchSource
} from '@/helpers/searchSources';

export interface PageScope<T> {
    type: string;
    icon: string;
    items: MaybeRefOrGetter<T[]>;
    keys: readonly string[];
    toHit: (item: T) => SearchHit;
}

export interface ResultSection {
    title: string;
    hits: SearchHit[];
}

const QUERY_MAX_LENGTH = 200;
const MIN_QUERY_LENGTH = 2;
const RESULTS_PER_SECTION = 10;

function fuseOptions<T>(keys: readonly string[]): IFuseOptions<T> {
    return {
        keys: [...keys],
        threshold: UI_CONFIG.search.threshold,
        ignoreLocation: UI_CONFIG.search.ignoreLocation,
        useExtendedSearch: true
    };
}

function buildIndex<T>(items: T[], keys: readonly string[]): Fuse<T> {
    return new Fuse(items, fuseOptions<T>(keys));
}

function topHits(fuse: Fuse<unknown>, query: string): unknown[] {
    return fuse
        .search(query, {limit: RESULTS_PER_SECTION})
        .map((match) => match.item);
}

function pageHits<T>(scope: PageScope<T>, query: string): SearchHit[] {
    const items = toValue(scope.items);
    if (items.length === 0) return [];
    const index = buildIndex(items, scope.keys);
    return topHits(index as Fuse<unknown>, query).map((item) =>
        scope.toHit(item as T)
    );
}

function sourceHits(source: SearchSource, query: string): SearchHit[] {
    const items = source.items();
    if (items.length === 0) return [];
    const index = buildIndex(items as unknown[], source.keys);
    return topHits(index, query).map((item) => source.toHit(item));
}

export function useUniversalSearch<T>(scope?: PageScope<T>) {
    const query = ref('');
    const open = ref(false);
    const highlightIndex = ref(0);

    function setQuery(next: string) {
        query.value = next.slice(0, QUERY_MAX_LENGTH);
    }

    const trimmed = computed(() => query.value.trim());

    const hasEnoughChars = computed(
        () => trimmed.value.length >= MIN_QUERY_LENGTH
    );

    const sections = computed<ResultSection[]>(() => {
        if (!hasEnoughChars.value) return [];
        const q = trimmed.value;
        const out: ResultSection[] = [];
        if (scope) {
            const hits = pageHits(scope, q);
            if (hits.length > 0) out.push({title: 'On this page', hits});
        }
        const cross: SearchHit[] = [];
        for (const source of buildSearchSources()) {
            if (scope && source.type === scope.type) continue;
            const hits = sourceHits(source, q);
            for (const hit of hits) cross.push(hit);
        }
        if (cross.length > 0) out.push({title: 'Across the app', hits: cross});
        return out;
    });

    const flat = computed<SearchHit[]>(() =>
        sections.value.flatMap((section) => section.hits)
    );

    const dropdownOpen = computed(() => open.value && hasEnoughChars.value);

    const highlighted = computed<SearchHit | null>(
        () => flat.value[highlightIndex.value] ?? null
    );

    function highlightNext() {
        if (flat.value.length === 0) return;
        highlightIndex.value = (highlightIndex.value + 1) % flat.value.length;
    }

    function highlightPrev() {
        if (flat.value.length === 0) return;
        const next = highlightIndex.value - 1;
        highlightIndex.value = next < 0 ? flat.value.length - 1 : next;
    }

    function resetHighlight() {
        highlightIndex.value = 0;
    }

    function openDropdown() {
        open.value = true;
    }

    function closeDropdown() {
        open.value = false;
        resetHighlight();
    }

    return {
        query,
        trimmed,
        dropdownOpen,
        sections,
        flat,
        highlighted,
        highlightIndex,
        setQuery,
        highlightNext,
        highlightPrev,
        resetHighlight,
        openDropdown,
        closeDropdown
    };
}
