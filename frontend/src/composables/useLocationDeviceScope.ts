import type {ComputedRef, Ref} from 'vue';
import {computed, watch} from 'vue';
import {useLocationsStore} from '@/stores/locations';

type MaybeLocationIds = ComputedRef<number[]> | Ref<number[]>;

function uniqueInts(ids: number[]): number[] {
    return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

function uniqueStrings(ids: string[]): string[] {
    return [...new Set(ids.filter((id) => id.length > 0))];
}

function collectDescendantLocationIds(
    childrenByParent: Record<number, number[]>,
    rootId: number
): number[] {
    const out = new Set<number>();
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current == null || out.has(current)) continue;
        out.add(current);
        for (const childId of childrenByParent[current] ?? []) {
            stack.push(childId);
        }
    }
    return [...out];
}

export function useLocationDeviceScope(locationIds: MaybeLocationIds) {
    const locationsStore = useLocationsStore();
    void locationsStore.fetchLocations();

    const rootLocationIds = computed(() => uniqueInts(locationIds.value));

    const childrenByParent = computed<Record<number, number[]>>(() => {
        const out: Record<number, number[]> = {};
        for (const loc of Object.values(locationsStore.locations)) {
            if (loc.parentLocationId == null) continue;
            (out[loc.parentLocationId] ??= []).push(loc.id);
        }
        return out;
    });

    const subtreeLocationIdsByRoot = computed<Record<number, number[]>>(() => {
        const out: Record<number, number[]> = {};
        for (const rootId of rootLocationIds.value) {
            out[rootId] = collectDescendantLocationIds(
                childrenByParent.value,
                rootId
            );
        }
        return out;
    });

    const allScopedLocationIds = computed(() =>
        uniqueInts(Object.values(subtreeLocationIdsByRoot.value).flat())
    );

    const deviceIdsByRoot = computed<Record<number, string[]>>(() => {
        const out: Record<number, string[]> = {};
        for (const rootId of rootLocationIds.value) {
            const deviceIds = new Set<string>();
            for (const locationId of subtreeLocationIdsByRoot.value[rootId] ??
                []) {
                for (const assignment of locationsStore.assignmentsByLocation[
                    locationId
                ] ?? []) {
                    if (assignment.subjectType === 'device') {
                        deviceIds.add(assignment.subjectId);
                    }
                }
            }
            out[rootId] = [...deviceIds];
        }
        return out;
    });

    const allDeviceIds = computed(() =>
        uniqueStrings(Object.values(deviceIdsByRoot.value).flat())
    );

    // Watch by primitive key — input ref re-emits new arrays on every store
    // tick, hitting the rate limiter with N identical fetches per second.
    watch(
        () =>
            rootLocationIds.value
                .slice()
                .sort((a, b) => a - b)
                .join(','),
        async () => {
            const ids = rootLocationIds.value;
            if (ids.length === 0) return;
            await locationsStore.fetchLocations();
            const scopedIds = uniqueInts(
                ids.flatMap((rootId) =>
                    collectDescendantLocationIds(childrenByParent.value, rootId)
                )
            );
            const missing = scopedIds.filter(
                (id) => locationsStore.assignmentsByLocation[id] == null
            );
            if (missing.length > 0) {
                await locationsStore.fetchAssignmentsBulk(missing);
            }
        },
        {immediate: true}
    );

    return {
        rootLocationIds,
        subtreeLocationIdsByRoot,
        allScopedLocationIds,
        deviceIdsByRoot,
        allDeviceIds
    };
}
