// Singleton dashboard-order state — shared between dash.vue and manage.vue
// so a reorder on /dash/manage shows up immediately on /dash/[id]'s pill
// bar without remounting the parent. localStorage is still authoritative;
// the ref is the in-memory mirror.

import {type Ref, ref} from 'vue';
import {
    type OrderedId,
    persistDashboardOrder,
    purgeOrderedIds,
    readDashboardOrder,
    reorderById
} from '@/helpers/dashboardOrder';

export interface UseDashboardOrderApi {
    readonly ids: Ref<readonly OrderedId[]>;
    // visibleIds is the current rendered order, so we can move an id even
    // when the persisted order is empty (fresh install — order is implicit).
    readonly move: (
        visibleIds: readonly OrderedId[],
        id: OrderedId,
        direction: -1 | 1
    ) => void;
    readonly purge: (drop: readonly OrderedId[]) => void;
    readonly replace: (next: readonly OrderedId[]) => void;
}

let cached: Ref<readonly OrderedId[]> | null = null;

export function useDashboardOrder(): UseDashboardOrderApi {
    const ids = (cached ??= ref<readonly OrderedId[]>(readDashboardOrder()));
    return {
        ids,
        move(visibleIds, id, direction) {
            const seed = ids.value.length > 0 ? ids.value : visibleIds;
            commit(ids, reorderById(seed, id, direction));
        },
        purge(drop) {
            commit(ids, purgeOrderedIds(ids.value, drop));
        },
        replace(next) {
            commit(ids, next);
        }
    };
}

function commit(
    ref: Ref<readonly OrderedId[]>,
    next: readonly OrderedId[]
): void {
    if (next === ref.value) return;
    ref.value = next;
    persistDashboardOrder(next);
}

// Test-only — drop the module-level cache between tests.
export function __resetDashboardOrderCacheForTests(): void {
    cached = null;
}
