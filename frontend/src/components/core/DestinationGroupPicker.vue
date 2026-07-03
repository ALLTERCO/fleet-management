<template>
    <div class="dgp">
        <div class="dgp__search">
            <i class="fas fa-search dgp__icon" />
            <input
                v-model="query"
                type="text"
                class="dgp__input core-input"
                :placeholder="placeholder ?? 'Search destinations…'"
            />
        </div>

        <div v-if="loading" class="dgp__loading">
            <Spinner size="sm" />
        </div>
        <EmptyBlock v-else-if="filteredDestinations.length === 0">
            <p>No destinations match.</p>
        </EmptyBlock>
        <div v-else class="dgp__grid">
            <button
                v-for="d in filteredDestinations"
                :key="d.id"
                type="button"
                class="dgp__card"
                :class="{'dgp__card--on': model.includes(d.id)}"
                @click="toggle(d.id)"
            >
                <i class="fas fa-bullhorn dgp__card-icon" aria-hidden="true" />
                <span class="dgp__card-name">{{ d.name }}</span>
                <span class="dgp__card-meta">
                    <span v-if="!d.enabled" class="dgp__disabled">Disabled · </span>
                    {{ d.counts.members }} member{{ d.counts.members === 1 ? '' : 's' }}
                </span>
            </button>
        </div>

        <div v-if="model.length > 0" class="dgp__summary">
            {{ model.length }} selected
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import Spinner from '@/components/core/Spinner.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {useDestinationsStore} from '@/stores/destinations';

const model = defineModel<number[]>({required: true});

defineProps<{placeholder?: string}>();

const store = useDestinationsStore();
const query = ref('');
const loading = ref(true);

onMounted(async () => {
    loading.value = true;
    try {
        await store.fetchDestinations();
    } finally {
        loading.value = false;
    }
});

const sortedDestinations = computed(() =>
    Object.values(store.destinations).sort((a, b) =>
        a.name.localeCompare(b.name)
    )
);

const filteredDestinations = useFuzzySearch(sortedDestinations, query, {
    keys: ['name', 'description']
});

function toggle(id: number) {
    const idx = model.value.indexOf(id);
    if (idx >= 0) {
        model.value = model.value.filter((x) => x !== id);
    } else {
        model.value = [...model.value, id];
    }
}
</script>

<style scoped>
.dgp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.dgp__search {
    position: relative;
    display: flex;
    align-items: center;
}
.dgp__icon {
    position: absolute;
    left: var(--space-3);
    color: var(--color-text-tertiary);
    opacity: 0.7;
    pointer-events: none;
}
.dgp__input {
    flex: 1;
    padding-left: var(--space-8);
}
.dgp__loading {
    display: flex;
    justify-content: center;
    padding: var(--space-3);
}
/* Selectable cards with a glow when picked — matches the scope picker. */
.dgp__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: var(--space-3);
    max-height: 320px;
    overflow-y: auto;
}
.dgp__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-4);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
    cursor: pointer;
    text-align: center;
    transition:
        border-color var(--duration-fast),
        background var(--duration-fast),
        box-shadow var(--duration-fast);
}
.dgp__card:hover {
    background: var(--color-surface-3);
    border-color: var(--color-primary);
}
.dgp__card--on {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent);
}
.dgp__card-icon {
    font-size: var(--icon-size-lg);
    color: var(--color-primary);
    margin-bottom: var(--space-1);
}
.dgp__card-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.dgp__card-meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.dgp__disabled {
    color: var(--color-text-disabled);
}
.dgp__summary {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    align-self: flex-end;
}
</style>
