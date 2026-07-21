<template>
    <div class="filter-pill">
        <div
            class="search-pill"
            :class="{'search-pill__input--filtered': hasActiveFilter}"
        >
            <i class="fas fa-search search-pill__icon" aria-hidden="true" />
            <input
                ref="inputRef"
                :value="model"
                type="text"
                class="search-pill__input"
                :placeholder="placeholder"
                :aria-label="placeholder"
                @input="onInput"
            />
            <button
                v-if="model"
                type="button"
                class="search-pill__clear"
                aria-label="Clear search"
                @click="clearQuery"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
            <button
                v-if="filterable"
                type="button"
                class="search-pill__filter"
                :class="{'search-pill__filter--active': hasActiveFilter}"
                aria-label="Open filters"
                @click="$emit('filter-click')"
            >
                <i class="fas fa-filter" aria-hidden="true" />
                <span
                    v-if="filterCount && filterCount > 0"
                    class="filter-pill__badge"
                >
                    {{ filterCount }}
                </span>
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
// Local filter field — narrows the data of the view it sits in. Nothing
// more: no global results, no navigation. (The app-wide search was removed
// on purpose; see git history of UniversalSearch.vue to bring it back.)
import {nextTick, onBeforeUnmount, onMounted, ref} from 'vue';
import {registerShortcut} from '@/config/shortcuts';

withDefaults(
    defineProps<{
        placeholder?: string;
        filterable?: boolean;
        hasActiveFilter?: boolean;
        filterCount?: number;
    }>(),
    {
        placeholder: 'Search…',
        filterable: false,
        hasActiveFilter: false
    }
);

defineEmits<{'filter-click': []}>();

const model = defineModel<string>({default: ''});
const inputRef = ref<HTMLInputElement | null>(null);

function onInput(e: Event) {
    model.value = (e.target as HTMLInputElement).value;
}

function clearQuery() {
    model.value = '';
    void nextTick(() => inputRef.value?.focus());
}

let unregShortcut: (() => void) | null = null;

onMounted(() => {
    unregShortcut = registerShortcut({
        id: 'search.focus',
        description: 'Focus page search',
        section: 'Global',
        allowInInput: true,
        handler: (e) => {
            e.preventDefault();
            inputRef.value?.focus();
        }
    });
});
onBeforeUnmount(() => {
    unregShortcut?.();
});
</script>

<style scoped>
.filter-pill {
    position: relative;
    width: 100%;
    max-width: var(--search-w-max);
    min-width: 0;
}

.filter-pill .search-pill {
    width: 100%;
}

.filter-pill__badge {
    position: absolute;
    top: calc(-1 * var(--space-1));
    right: calc(-1 * var(--space-1));
    min-width: var(--space-4);
    height: var(--space-4);
    padding: 0 var(--space-1);
    border-radius: var(--radius-full);
    background: var(--color-primary);
    color: var(--color-text-on-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    line-height: var(--space-4);
    text-align: center;
}
</style>
