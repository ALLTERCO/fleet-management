<template>
    <div class="lk" role="group" aria-label="Location rollup metrics">
        <div v-if="visible.has('devices')" class="lk__metric lk__metric--headline">
            <span class="lk__caption">Devices online</span>
            <span class="lk__value">
                <span class="lk__dot" aria-hidden="true" />{{ onlineSplit.online }} <span class="lk__divider">/</span> {{ deviceCount }}
            </span>
        </div>

        <div v-if="visible.has('offline')" class="lk__metric">
            <span class="lk__caption">Offline</span>
            <span class="lk__value">{{ onlineSplit.offline }}</span>
        </div>

        <div v-if="visible.has('alerts') && alertCount > 0" class="lk__metric">
            <span class="lk__caption">Alerts</span>
            <span class="lk__value lk__value--warn">{{ alertCount }}</span>
        </div>

        <div v-if="visible.has('power') && powerSumWatts != null" class="lk__metric">
            <span class="lk__caption">Power</span>
            <span class="lk__value">{{ formatPower(powerSumWatts) }}</span>
        </div>

        <div v-if="visible.has('temperature') && temperature != null" class="lk__metric">
            <span class="lk__caption">Temperature</span>
            <span class="lk__value">{{ formatTemperature(temperature) }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import type {LocationKind} from '@api/location';
import {computed} from 'vue';
import type {TemperatureSummary} from '@/composables/useLocationRollups';
import {visibleKpisForKind} from '@/helpers/location-kinds';
import type {OnlineSplit} from '@/helpers/locationRollups';

const props = defineProps<{
    kind: LocationKind | null;
    deviceCount: number;
    onlineSplit: OnlineSplit;
    alertCount: number;
    powerSumWatts: number | null;
    temperature: TemperatureSummary | null;
}>();

// Reactive visibility set — recomputes only on kind change.
const visible = computed(() => visibleKpisForKind(props.kind));

function formatPower(watts: number): string {
    if (watts >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
    return `${Math.round(watts)} W`;
}

function formatTemperature(t: TemperatureSummary): string {
    return `${Math.round(t.avgCelsius)}°C`;
}
</script>

<style scoped>
.lk {
    display: flex;
    align-items: flex-end;
    gap: var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--color-border-default);
}

.lk__metric {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.lk__caption {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    letter-spacing: 0.02em;
    text-transform: uppercase;
}

.lk__value {
    font-size: var(--type-subheading);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.lk__value--warn {
    color: var(--color-status-warn);
}

.lk__divider {
    color: var(--color-text-quaternary);
    font-weight: var(--font-normal);
}

/* Single Shelly Blue dot prefix on the headline metric — the only colored
   mark in the strip. Same blue used by the selected tree row stripe and
   the last breadcrumb segment in the detail header, on purpose. */
.lk__dot {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--color-primary);
    flex-shrink: 0;
}
</style>
