<template>
    <div class="kti" :class="`kti--${tone}`">
        <span class="kti__label">{{ label }}</span>
        <span class="kti__value">
            <TweenNumber
                v-if="typeof value === 'number'"
                :value="value"
                :decimals="decimals ?? 0"
            />
            <template v-else>{{ value }}</template>
            <span v-if="suffix" class="kti__suffix">{{ suffix }}</span>
        </span>
    </div>
</template>

<script setup lang="ts">
import TweenNumber from '@/components/core/TweenNumber.vue';

export type KpiTone = 'neutral' | 'on' | 'warn' | 'alert' | 'critical';

defineProps<{
    label: string;
    value: string | number;
    tone: KpiTone;
    suffix?: string;
    decimals?: number;
}>();
</script>

<style scoped>
.kti {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--state-hover-bg);
    min-width: 0;
}

.kti__label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.kti__value {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-0-5);
}
.kti__suffix {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-tertiary);
}

.kti--on .kti__value {
    color: var(--color-status-on);
}

.kti--warn .kti__value,
.kti--alert .kti__value {
    color: var(--color-status-warn);
}

.kti--critical .kti__value {
    color: var(--color-status-off);
}
</style>
