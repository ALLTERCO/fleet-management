<template>
    <div class="dfb">
        <header v-if="$slots.header" class="dfb__header">
            <slot name="header" />
        </header>

        <div v-if="devices.length === 0" class="dfb__empty">
            <i class="fas fa-circle-nodes" />
            <p>No devices to plot.</p>
        </div>

        <div v-else-if="devices.length > maxBubbles" class="dfb__overflow">
            <i class="fas fa-table-cells" />
            <p>
                {{ devices.length }} devices — too many to plot as bubbles.
                Showing the top {{ maxBubbles }} by {{ metricLabel ?? 'metric' }}.
            </p>
        </div>

        <svg
            v-if="placed.length > 0"
            class="dfb__svg"
            :viewBox="`0 0 ${width} ${height}`"
            :aria-label="`Fleet bubble graph: ${devices.length} devices`"
            role="img"
        >
            <g
                v-for="bubble in placed"
                :key="bubble.input.id"
                class="dfb__group"
                :class="`dfb__group--${bubble.input.status}`"
                :tabindex="0"
                role="button"
                :aria-label="bubbleLabel(bubble.input)"
                @click="$emit('select', bubble.input.id)"
                @keydown.enter.prevent="$emit('select', bubble.input.id)"
            >
                <circle
                    class="dfb__bubble"
                    :cx="bubble.cx"
                    :cy="bubble.cy"
                    :r="bubble.r"
                />
                <text
                    v-if="bubble.r >= LABEL_RADIUS_MIN"
                    class="dfb__value"
                    :x="bubble.cx"
                    :y="bubble.cy"
                    text-anchor="middle"
                    dominant-baseline="central"
                >{{ formatMetric(bubble.input.metric) }}</text>
            </g>
        </svg>

        <ul v-if="placed.length > 0" class="dfb__legend">
            <li>
                <span class="dfb__legend-dot dfb__legend-dot--online" /> Online
            </li>
            <li>
                <span class="dfb__legend-dot dfb__legend-dot--alarm" /> Alarm
            </li>
            <li>
                <span class="dfb__legend-dot dfb__legend-dot--offline" /> Offline
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {layoutBubbles, requiredHeight} from '@/helpers/bubbleLayout';
import type {DashFleetBubbleDevice} from '@/types/dashboard-components';

const LABEL_RADIUS_MIN = 18;
const DEFAULT_WIDTH = 600;
const DEFAULT_MIN_HEIGHT = 320;

const props = withDefaults(
    defineProps<{
        devices: DashFleetBubbleDevice[];
        metricUnit?: string;
        metricLabel?: string;
        maxBubbles?: number;
        width?: number;
    }>(),
    {
        metricUnit: '',
        metricLabel: '',
        maxBubbles: 150,
        width: DEFAULT_WIDTH
    }
);

defineEmits<(e: 'select', id: number | string) => void>();

const truncated = computed(() =>
    [...props.devices]
        .sort((a, b) => b.metric - a.metric)
        .slice(0, props.maxBubbles)
);

const placed = computed(() =>
    layoutBubbles(truncated.value, {
        width: props.width,
        height: DEFAULT_MIN_HEIGHT
    })
);

const height = computed(() =>
    requiredHeight(truncated.value.length, {
        width: props.width,
        height: DEFAULT_MIN_HEIGHT
    })
);

function formatMetric(value: number): string {
    if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
    if (Math.abs(value) >= 10) return value.toFixed(0);
    return value.toFixed(1);
}

function bubbleLabel(device: DashFleetBubbleDevice): string {
    const unit = props.metricUnit ? ` ${props.metricUnit}` : '';
    return `${device.name} — ${formatMetric(device.metric)}${unit} (${device.status})`;
}
</script>

<style scoped>
.dfb {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.dfb__header {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.dfb__svg {
    width: 100%;
    display: block;
}

.dfb__group {
    cursor: pointer;
    transition: opacity var(--duration-fast) var(--ease-default);
    outline: none;
}

.dfb__group:hover .dfb__bubble,
.dfb__group:focus-visible .dfb__bubble {
    filter: brightness(1.15);
    stroke-width: 2;
}

.dfb__bubble {
    stroke: var(--color-chart-overlay-subtle);
    stroke-width: 1;
    transition: filter var(--duration-fast) var(--ease-default);
}

.dfb__group--online .dfb__bubble {
    fill: color-mix(in srgb, var(--color-success) 70%, transparent);
}

.dfb__group--alarm .dfb__bubble {
    fill: color-mix(in srgb, var(--color-danger) 75%, transparent);
}

.dfb__group--offline .dfb__bubble {
    fill: color-mix(in srgb, var(--color-text-quaternary) 40%, transparent);
}

.dfb__value {
    fill: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    font-variant-numeric: tabular-nums;
    pointer-events: none;
}

.dfb__empty,
.dfb__overflow {
    padding: var(--space-6) var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
}

.dfb__empty i,
.dfb__overflow i {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
}

.dfb__overflow p,
.dfb__empty p {
    margin: 0;
    font-size: var(--type-caption);
}

.dfb__legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: var(--space-4);
    justify-content: center;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.dfb__legend li {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.dfb__legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
}

.dfb__legend-dot--online {
    background: color-mix(in srgb, var(--color-success) 70%, transparent);
}

.dfb__legend-dot--alarm {
    background: color-mix(in srgb, var(--color-danger) 75%, transparent);
}

.dfb__legend-dot--offline {
    background: color-mix(in srgb, var(--color-text-quaternary) 40%, transparent);
}
</style>
