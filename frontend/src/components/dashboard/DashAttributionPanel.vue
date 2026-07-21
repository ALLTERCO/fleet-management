<template>
    <div class="dap" role="region" aria-label="Window attribution">
        <header class="dap__hdr">
            <div class="dap__hdr-text">
                <h3 class="dap__title">Top contributors</h3>
                <p v-if="range" class="dap__range">
                    <i class="fas fa-crosshairs" aria-hidden="true" />
                    {{ range.from }} – {{ range.to }}
                </p>
            </div>
            <button
                v-if="closable"
                type="button"
                class="dap__close"
                aria-label="Close attribution panel"
                @click="$emit('close')"
            >
                <i class="fas fa-xmark" aria-hidden="true" />
            </button>
        </header>

        <DashboardState v-if="error" state="error" :error="error" title="Failed to load contributors" @retry="$emit('retry')" />
        <DashboardState v-else-if="loading && !result" state="loading" title="Aggregating" />
        <DashboardState v-else-if="!result" state="empty" icon="fas fa-crosshairs" title="Select a range" message="Click Compare on the chart and drag across the window you want to inspect." />
        <template v-else>
            <div class="dap__total">
                <span class="dap__total-value">{{ formatTotal(result.totalValue) }}</span>
                <span class="dap__total-unit">{{ result.unit }}</span>
                <span class="dap__total-label">total across selection</span>
            </div>

            <ul v-if="result.contributors.length" class="dap__list">
                <li
                    v-for="c in result.contributors"
                    :key="c.deviceId"
                    class="dap__row"
                >
                    <div class="dap__row-head">
                        <span class="dap__row-name">{{ c.deviceName }}</span>
                        <span class="dap__row-share">{{ (c.share * 100).toFixed(0) }}%</span>
                    </div>
                    <div class="dap__row-bar">
                        <div class="dap__row-fill" :style="{width: (c.share * 100).toFixed(1) + '%'}" />
                    </div>
                    <div class="dap__row-meta">
                        {{ formatValue(c.value) }} {{ result.unit }}
                        <span class="dap__row-samples">{{ c.sampleCount }} samples</span>
                    </div>
                </li>
            </ul>
            <DashboardState v-else state="empty" icon="fas fa-circle-info" title="No data in window" message="The selected range did not contain any samples for the chosen metric." />

            <p v-if="result.truncated" class="dap__truncated">
                <i class="fas fa-circle-info" aria-hidden="true" />
                Showing top {{ result.contributors.length }} — {{ result.truncatedCount }} more devices contributed but were dropped past the limit.
            </p>
        </template>
    </div>
</template>

<script setup lang="ts">
import type {AttributeWindowResult} from '@api/analytics';
import DashboardState from '@/components/dashboard/DashboardState.vue';

defineProps<{
    range: {from: string; to: string} | null;
    result: AttributeWindowResult | null;
    loading?: boolean;
    error?: string | null;
    closable?: boolean;
}>();

defineEmits<{
    (e: 'close'): void;
    (e: 'retry'): void;
}>();

function formatValue(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1000) return n.toFixed(0);
    if (abs >= 10) return n.toFixed(1);
    return n.toFixed(2);
}

function formatTotal(n: number): string {
    return formatValue(n);
}
</script>

<style scoped>
.dap {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.dap__hdr {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
}
.dap__hdr-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.dap__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.dap__range {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}
.dap__range i {
    color: var(--color-primary);
}
.dap__close {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    border-radius: var(--radius-full);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.dap__close:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}
.dap__total {
    display: flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border-radius: var(--radius-md);
}
.dap__total-value {
    font-size: var(--type-subheading);
    font-weight: 700;
    color: var(--color-text-primary);
}
.dap__total-unit {
    color: var(--color-text-secondary);
    font-size: var(--type-body);
}
.dap__total-label {
    margin-left: auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.dap__list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.dap__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.dap__row-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: var(--type-body);
}
.dap__row-name {
    color: var(--color-text-primary);
    font-weight: var(--font-medium);
}
.dap__row-share {
    color: var(--color-text-secondary);
    font-feature-settings: 'tnum';
}
.dap__row-bar {
    height: 6px;
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
}
.dap__row-fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(var(--color-primary-rgb), 0.5), var(--color-primary));
    border-radius: var(--radius-full);
    transition: width var(--duration-normal) var(--ease-default);
}
.dap__row-meta {
    display: flex;
    justify-content: space-between;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.dap__row-samples {
    font-variant-numeric: tabular-nums;
}
.dap__truncated {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}
.dap__truncated i {
    color: var(--color-primary);
}
</style>
