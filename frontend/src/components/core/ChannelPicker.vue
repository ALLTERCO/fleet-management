<template>
    <div class="epp">
        <div v-if="loading" class="epp__loading">
            <Spinner size="sm" />
        </div>
        <EmptyBlock v-else-if="sortedChannels.length === 0">
            <p>No channels available yet.</p>
        </EmptyBlock>
        <div v-else class="epp__grid">
            <button
                v-for="ep in sortedChannels"
                :key="ep.id"
                type="button"
                class="epp__card"
                :class="{'epp__card--on': model.includes(ep.id)}"
                @click="toggle(ep.id)"
            >
                <ProviderLogo :provider="ep.provider" size="md" />
                <span class="epp__card-name">{{ ep.name }}</span>
                <span v-if="!ep.enabled" class="epp__disabled">Disabled</span>
            </button>
        </div>

        <div v-if="model.length > 0" class="epp__summary">
            {{ model.length }} selected
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, ref} from 'vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ProviderLogo from '@/components/core/ProviderLogo.vue';
import Spinner from '@/components/core/Spinner.vue';
import {useChannelsStore} from '@/stores/channels';

const model = defineModel<number[]>({required: true});

const store = useChannelsStore();
const loading = ref(true);

onMounted(async () => {
    loading.value = true;
    try {
        await store.fetchChannels();
    } finally {
        loading.value = false;
    }
});

const sortedChannels = computed(() =>
    Object.values(store.channels).sort((a, b) => a.name.localeCompare(b.name))
);

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
.epp {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.epp__loading {
    display: flex;
    justify-content: center;
    padding: var(--space-3);
}
/* Selectable cards with a glow when picked — matches the group picker. */
.epp__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: var(--space-3);
    max-height: 320px;
    overflow-y: auto;
}
.epp__card {
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
.epp__card:hover {
    background: var(--color-surface-3);
    border-color: var(--color-primary);
}
.epp__card--on {
    border-color: var(--color-primary);
    background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 35%, transparent);
}
.epp__card-name {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.epp__disabled {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
.epp__summary {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    align-self: flex-end;
}
</style>
