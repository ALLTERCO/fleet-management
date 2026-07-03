<template>
    <div v-if="presets.length > 0" class="rpc">
        <button
            v-for="preset in presets"
            :key="preset.key"
            type="button"
            class="rpc__chip"
            @click="emit('pick', preset.config)"
        >
            <i :class="['rpc__icon', preset.icon]" aria-hidden="true" />
            {{ preset.label }}
        </button>
    </div>
</template>

<script setup lang="ts">
import type {AlertRuleKind, AlertRuleTemplate} from '@api/alert';
import {computed, onMounted, ref} from 'vue';
import {presetsForKind} from '@/helpers/rulePresets';
import {useAlertsStore} from '@/stores/alerts';

const props = defineProps<{kind: AlertRuleKind}>();

const emit = defineEmits<{pick: [config: Record<string, unknown>]}>();

// Quick-picks come from the backend starters — the single source for config.
const store = useAlertsStore();
const templates = ref<AlertRuleTemplate[]>([]);

onMounted(async () => {
    templates.value = await store.listTemplates();
});

const presets = computed(() => presetsForKind(templates.value, props.kind));
</script>

<style scoped>
.rpc {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.rpc__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background-color var(--motion-hover);
}

.rpc__chip:hover {
    background: var(--color-surface-3);
    border-color: var(--color-primary);
}

.rpc__chip:focus-visible {
    outline: var(--focus-ring-width) solid var(--focus-ring-color);
    outline-offset: var(--focus-ring-offset);
}

.rpc__icon {
    color: var(--color-primary-text);
}
</style>
