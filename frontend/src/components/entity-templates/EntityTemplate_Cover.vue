<template>
    <div class="et-cover">
        <div class="et-cover__header">
            <span class="et-cover__state">{{ stateLabel }}</span>
            <div v-if="canExecute" class="et-cover__actions">
                <button class="et-cover__btn" @click="emit('open')">
                    <i class="fas fa-arrow-up" />
                </button>
                <button class="et-cover__btn" @click="emit('stop')">
                    <i class="fas fa-stop" />
                </button>
                <button class="et-cover__btn" @click="emit('close')">
                    <i class="fas fa-arrow-down" />
                </button>
            </div>
        </div>

        <CoverPosition
            v-if="canExecute && status"
            :position="status?.current_pos ?? 0"
            :calibrated="status?.pos_control ?? false"
            :favorites="favorites ?? []"
            @change="(v: number) => emit('setPosition', v)"
        />

        <!-- Power metering (some covers report it) -->
        <div v-if="metrics.length" class="et-cover__metrics">
            <div v-for="m in metrics" :key="m.label" class="et-cover__card">
                <span class="et-cover__value">{{ m.value }}</span>
                <span class="et-cover__label">{{ m.label }}</span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import CoverPosition from '@/components/core/Cover/CoverPosition.vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    favorites?: number[];
    canExecute: boolean;
}>();

const emit = defineEmits<{
    open: [];
    stop: [];
    close: [];
    setPosition: [number];
}>();

interface Metric {
    label: string;
    value: string;
}

const stateLabel = computed(() => {
    const state = props.status?.state;
    if (!state) return 'Unknown';
    return String(state).charAt(0).toUpperCase() + String(state).slice(1);
});

const metrics = computed<Metric[]>(() => {
    const s = props.status;
    if (!s) return [];
    const out: Metric[] = [];
    if (s.apower !== undefined) out.push({label: 'Power', value: `${s.apower} W`});
    if (s.current !== undefined) out.push({label: 'Current', value: `${s.current} A`});
    return out;
});
</script>

<style scoped>
.et-cover {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}
.et-cover__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.et-cover__state {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--color-text-secondary);
}
.et-cover__actions {
    display: flex;
    gap: 0.25rem;
}
.et-cover__btn {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-cover__btn:hover {
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
}
.et-cover__metrics {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 0.375rem;
}
.et-cover__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem;
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-cover__value {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-cover__label {
    font-size: var(--text-xs);
    color: var(--color-text-disabled);
    text-align: center;
}
</style>
