<template>
    <div class="et-num">
        <div class="et-num__value-card">
            <span class="et-num__value">{{ displayValue }}</span>
            <span v-if="unit" class="et-num__unit">{{ unit }}</span>
        </div>

        <div v-if="hasBoundedRange" class="et-num__meta">
            <span class="et-num__meta-range">
                {{ formatBound(effectiveMin) }}<template v-if="unit"> {{ unit }}</template>
                <span class="et-num__meta-sep">–</span>
                {{ formatBound(effectiveMax) }}<template v-if="unit"> {{ unit }}</template>
            </span>
            <span v-if="effectiveStep && effectiveStep !== 1" class="et-num__meta-step">
                step {{ formatBound(effectiveStep) }}
            </span>
        </div>

        <div v-if="canExecute && resolvedView === 'slider'" class="et-num__control">
            <HorizontalSlider
                :value="numericValue"
                :min="effectiveMin"
                :max="effectiveMax"
                :step="effectiveStep"
                :disabled="!canExecute"
                @change="(v: number) => emit('set', v)"
            >
                <template #title>
                    {{ numericValue }}<template v-if="unit"> {{ unit }}</template>
                </template>
            </HorizontalSlider>
        </div>

        <div v-else-if="resolvedView === 'progressbar'" class="et-num__progress">
            <div
                class="et-num__progress-bar"
                role="progressbar"
                :aria-valuemin="effectiveMin"
                :aria-valuemax="effectiveMax"
                :aria-valuenow="numericValue"
            >
                <div
                    class="et-num__progress-fill"
                    :style="{width: progressPercent + '%'}"
                />
            </div>
            <span class="et-num__progress-text">{{ progressPercent }}%</span>
        </div>

        <form
            v-else-if="canExecute && resolvedView === 'field'"
            class="et-num__field"
            @submit.prevent="submitValue"
        >
            <input
                v-model.number="inputValue"
                type="number"
                class="et-num__input"
                :min="effectiveMin"
                :max="effectiveMax"
                :step="effectiveStep"
            />
            <button type="submit" class="et-num__submit">Set</button>
        </form>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import HorizontalSlider from '@/components/core/HorizontalSlider.vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    view?: string;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
}>();

const emit = defineEmits<{set: [value: number]}>();

const numericValue = computed(() => {
    const v = props.status?.value;
    return typeof v === 'number' ? v : 0;
});

const displayValue = computed(() => {
    const v = props.status?.value;
    if (v == null) return 'N/A';
    return String(v);
});

const effectiveMin = computed(() => props.min ?? 0);
const effectiveMax = computed(() => props.max ?? 100);
const effectiveStep = computed(() => {
    const s = props.step ?? 1;
    return s > 0 ? s : 1;
});

const hasBoundedRange = computed(
    () =>
        typeof props.min === 'number' &&
        typeof props.max === 'number' &&
        props.max > props.min
);

const resolvedView = computed(() => {
    if (props.view === 'slider' || props.view === 'field' || props.view === 'progressbar') {
        return props.view;
    }
    if (!props.canExecute && hasBoundedRange.value) return 'progressbar';
    if (props.canExecute && hasBoundedRange.value) return 'slider';
    if (props.canExecute) return 'field';
    return null;
});

const progressPercent = computed(() => {
    const range = effectiveMax.value - effectiveMin.value;
    if (range <= 0) return 0;
    return Math.round(
        ((numericValue.value - effectiveMin.value) / range) * 100
    );
});

function formatBound(n: number): string {
    if (Number.isInteger(n)) return String(n);
    return n.toFixed(2).replace(/\.?0+$/, '');
}

const inputValue = ref(numericValue.value);
watch(numericValue, (v) => {
    inputValue.value = v;
});

function submitValue() {
    emit('set', inputValue.value);
}
</script>

<style scoped>
.et-num {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-num__value-card {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: var(--space-1);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
}
.et-num__value {
    font-size: var(--type-subheading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.et-num__unit {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.et-num__meta {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    letter-spacing: var(--tracking-wide);
}
.et-num__meta-sep {
    margin: 0 4px;
    color: var(--color-text-quaternary);
}
.et-num__meta-step {
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}
.et-num__control {
    padding-top: var(--space-1);
}
.et-num__progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}
.et-num__progress-bar {
    flex: 1;
    height: 6px;
    border-radius: var(--radius-xs);
    background-color: var(--color-surface-3);
    overflow: hidden;
}
.et-num__progress-fill {
    height: 100%;
    border-radius: var(--radius-xs);
    background-color: var(--color-primary);
    transition: width var(--duration-normal) var(--ease-default);
}
.et-num__progress-text {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    min-width: 2.5rem;
    text-align: right;
}
.et-num__field {
    display: flex;
    gap: var(--space-1-5);
}
.et-num__input {
    flex: 1;
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    text-align: center;
}
.et-num__input:focus {
    outline: none;
    border-color: var(--color-primary);
}
.et-num__submit {
    padding: var(--space-1-5) var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.et-num__submit:hover {
    background-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}
</style>
