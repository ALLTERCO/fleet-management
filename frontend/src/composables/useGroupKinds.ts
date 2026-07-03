// Lazy in-memory cache for the Group.Kind catalog. The catalog is 239
// entries and ~kilobytes — fetched once per session, served from memory
// for every dropdown / lookup after that.

import {type ComputedRef, computed, ref} from 'vue';
import * as ws from '@/tools/websocket';

export interface GroupKind {
    id: string;
    displayName: string;
    description: string | null;
    category: string;
    icon: string | null;
    metadataSchema: Record<string, unknown>;
    sortOrder: number;
}

const cache = ref<GroupKind[]>([]);
const loading = ref(false);
const loadedOnce = ref(false);
const loadError = ref<string | null>(null);
let inflight: Promise<void> | null = null;

async function fetchKinds(): Promise<void> {
    const res = await ws.sendRPC<{items: GroupKind[]}>(
        'FLEET_MANAGER',
        'group.kind.list',
        {}
    );
    cache.value = res?.items ?? [];
    loadedOnce.value = true;
    loadError.value = null;
}

export interface UseGroupKindsResult {
    kinds: ComputedRef<readonly GroupKind[]>;
    byId: ComputedRef<ReadonlyMap<string, GroupKind>>;
    byCategory: ComputedRef<ReadonlyMap<string, GroupKind[]>>;
    loading: ComputedRef<boolean>;
    loadedOnce: ComputedRef<boolean>;
    /** Last fetch error message, or null on success / never-fetched. */
    loadError: ComputedRef<string | null>;
    /** Triggers fetch on first call; later calls are no-ops. */
    ensureLoaded(): Promise<void>;
    /** Force a fresh fetch — used by the picker's "Retry" after an error. */
    retry(): Promise<void>;
    /** Case-insensitive search over displayName + description. */
    search(query: string): readonly GroupKind[];
}

function asMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === 'string' ? err : 'Failed to load group kinds.';
}

function startFetch(): Promise<void> {
    loading.value = true;
    loadError.value = null;
    inflight = fetchKinds()
        .catch((err) => {
            loadError.value = asMessage(err);
        })
        .finally(() => {
            loading.value = false;
            inflight = null;
        });
    return inflight;
}

export function useGroupKinds(): UseGroupKindsResult {
    const ensureLoaded = async (): Promise<void> => {
        if (loadedOnce.value) return;
        if (inflight) return inflight;
        return startFetch();
    };

    const retry = async (): Promise<void> => {
        if (inflight) return inflight;
        return startFetch();
    };

    const byId = computed<ReadonlyMap<string, GroupKind>>(() => {
        const m = new Map<string, GroupKind>();
        for (const k of cache.value) m.set(k.id, k);
        return m;
    });

    const byCategory = computed<ReadonlyMap<string, GroupKind[]>>(() => {
        const m = new Map<string, GroupKind[]>();
        for (const k of cache.value) {
            const bucket = m.get(k.category);
            if (bucket) bucket.push(k);
            else m.set(k.category, [k]);
        }
        // Stable sort within each category — sortOrder first, then displayName.
        for (const arr of m.values()) {
            arr.sort(
                (a, b) =>
                    a.sortOrder - b.sortOrder ||
                    a.displayName.localeCompare(b.displayName)
            );
        }
        return m;
    });

    const search = (query: string): readonly GroupKind[] => {
        const q = query.trim().toLowerCase();
        if (!q) return cache.value;
        return cache.value.filter((k) => {
            if (k.displayName.toLowerCase().includes(q)) return true;
            if (k.description?.toLowerCase().includes(q)) return true;
            return false;
        });
    };

    return {
        kinds: computed(() => cache.value),
        byId,
        byCategory,
        loading: computed(() => loading.value),
        loadedOnce: computed(() => loadedOnce.value),
        loadError: computed(() => loadError.value),
        ensureLoaded,
        retry,
        search
    };
}
