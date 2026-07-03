import {computed, type Ref, ref} from 'vue';

export function useSortableTable<T>(
    items: Ref<T[]>,
    defaultSort: string,
    defaultAsc = true,
    comparators: Record<string, (a: T, b: T) => number> = {}
) {
    const sortKey = ref(defaultSort);
    const sortAsc = ref(defaultAsc);

    function toggleSort(key: string) {
        if (sortKey.value === key) {
            sortAsc.value = !sortAsc.value;
        } else {
            sortKey.value = key;
            sortAsc.value = true;
        }
    }

    const sorted = computed(() => {
        const cmp = comparators[sortKey.value];
        if (!cmp) return [...items.value];
        return [...items.value].sort((a, b) => {
            const result = cmp(a, b);
            return sortAsc.value ? result : -result;
        });
    });

    return {sortKey, sortAsc, toggleSort, sorted};
}
