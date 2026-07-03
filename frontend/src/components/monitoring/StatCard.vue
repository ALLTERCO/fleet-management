<template>
    <div class="metric-tile" :class="stateClass">
        <div class="metric-tile__label">{{ label }}</div>
        <div class="metric-tile__row">
            <span class="metric-tile__value" :class="textClass"
                >{{ value }}<span v-if="suffix" class="metric-tile__suffix">{{ suffix }}</span></span
            >
            <SparkLine
                v-if="sparkData.length > 1"
                :data="sparkData"
                :color="color"
                :width="64"
                :height="22"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import SparkLine from './SparkLine.vue';

const props = withDefaults(
    defineProps<{
        label: string;
        value: string | number;
        suffix?: string;
        sparkData?: number[];
        color?: string;
        warn?: boolean;
        critical?: boolean;
    }>(),
    {
        suffix: '',
        sparkData: () => [],
        // Empty falls back to the brand-blue token inside SparkLine.
        color: '',
        warn: false,
        critical: false
    }
);

const textClass = computed(() => {
    if (props.critical) return 'metric--critical';
    if (props.warn) return 'metric--warning';
    return 'metric--default';
});
const stateClass = computed(() => {
    if (props.critical) return 'metric-tile--critical';
    if (props.warn) return 'metric-tile--warning';
    return '';
});
</script>

<style scoped>
.metric-tile {
    position: relative;
    padding: var(--gap-md);
    border-radius: var(--radius-md, 8px);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-subtle);
    overflow: hidden;
}
/* Accent bar down the left edge — the familiar console metric-tile cue. */
.metric-tile::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--color-border-medium, var(--color-border-default));
}
.metric-tile--warning::before {
    background: var(--color-warning-text, var(--color-orange-text));
}
.metric-tile--critical::before {
    background: var(--color-danger-text);
}
.metric-tile__label {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: var(--gap-xs);
}
.metric-tile__row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--gap-sm);
}
.metric-tile__value {
    font-family: var(--font-mono);
    font-size: var(--type-title, 1.25rem);
    font-weight: var(--font-semibold);
    line-height: 1.1;
}
.metric-tile__suffix {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    margin-left: 2px;
}
.metric--critical {
    color: var(--color-danger-text);
}
.metric--warning {
    color: var(--color-warning-text, var(--color-orange-text));
}
.metric--default {
    color: var(--color-text-primary);
}
</style>
