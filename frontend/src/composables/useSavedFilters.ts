import {type Ref, shallowRef, watch} from 'vue';

export interface SavedFilter<T> {
    name: string;
    value: T;
}

// LocalStorage-backed named filter presets. `shallowRef` keeps the generic
// value type opaque so callers see `T`, not `UnwrapRef<T>`.
export function useSavedFilters<T>(key: string) {
    const storageKey = `fm.savedFilters.${key}`;
    const filters: Ref<SavedFilter<T>[]> = shallowRef(load());

    function load(): SavedFilter<T>[] {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? (parsed as SavedFilter<T>[]) : [];
        } catch {
            return [];
        }
    }

    function persist() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(filters.value));
        } catch {
            // Quota or privacy-mode errors are non-fatal.
        }
    }

    watch(filters, persist);

    function save(name: string, value: T) {
        const next = filters.value.filter((f) => f.name !== name);
        next.push({name, value});
        filters.value = next;
    }

    function remove(name: string) {
        filters.value = filters.value.filter((f) => f.name !== name);
    }

    function get(name: string): T | null {
        return filters.value.find((f) => f.name === name)?.value ?? null;
    }

    return {filters, save, remove, get};
}
