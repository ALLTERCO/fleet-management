<template>
    <div class="dcb">
        <div v-if="loading" class="dcb__skeleton" />
        <template v-else-if="!hasData">
            <div class="dcb__empty">No data for this period.</div>
        </template>
        <template v-else>
            <div class="dcb__row">
                <span class="dcb__label"><i class="fas fa-bolt dcb__icon dcb__icon--grid" /> Grid imported</span>
                <span class="dcb__value">{{ formatKwh(b.gridKWh) }} kWh</span>
                <span class="dcb__kg">{{ formatKg(b.gridKgCO2) }} kg CO₂e</span>
            </div>
            <div class="dcb__row">
                <span class="dcb__label"><i class="fas fa-house-sun dcb__icon dcb__icon--self" /> Solar self-consumed</span>
                <span class="dcb__value">{{ formatKwh(b.solarSelfConsumedKWh) }} kWh</span>
                <span class="dcb__kg">0 kg avoided here</span>
            </div>
            <div class="dcb__row">
                <span class="dcb__label"><i class="fas fa-arrow-up dcb__icon dcb__icon--export" /> Solar exported</span>
                <span class="dcb__value">{{ formatKwh(b.solarExportedKWh) }} kWh</span>
                <span class="dcb__kg">{{ formatKg(b.avoidedKgCO2) }} kg avoided</span>
            </div>
            <div class="dcb__bar" :title="`Grid ${gridPct}% / Solar ${100 - gridPct}%`">
                <div class="dcb__seg dcb__seg--grid" :style="{width: gridPct + '%'}" />
                <div class="dcb__seg dcb__seg--self" :style="{width: (100 - gridPct) + '%'}" />
            </div>
            <div class="dcb__factor">at {{ factor }} g CO₂e/kWh (LBM)</div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    totalConsumedKWh: number;
    totalReturnedKWh: number;
    factorGPerKWh: number;
    loading?: boolean;
}>();

// Mirrors backend computeCarbonSourceBreakdown — kept pure + tiny so the
// authoritative report stays in carbonSourceAttribution.ts.
const b = computed(() => {
    const consumed = props.totalConsumedKWh;
    const returned = props.totalReturnedKWh;
    const f = props.factorGPerKWh;
    const grid = Math.max(0, consumed - returned);
    const solarSelf = Math.min(consumed, returned);
    const solarExport = returned;
    return {
        gridKWh: grid,
        solarSelfConsumedKWh: solarSelf,
        solarExportedKWh: solarExport,
        gridKgCO2: (grid * f) / 1000,
        avoidedKgCO2: (solarExport * f) / 1000
    };
});

const hasData = computed(
    () => props.totalConsumedKWh > 0 || props.totalReturnedKWh > 0
);

const factor = computed(() => props.factorGPerKWh || 0);

const gridPct = computed(() => {
    const split = b.value.gridKWh + b.value.solarSelfConsumedKWh;
    if (split <= 0) return 100;
    return Math.round((b.value.gridKWh / split) * 100);
});

function formatKwh(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 1});
}
function formatKg(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 2});
}
</script>

<style scoped>
.dcb__skeleton {
    height: 120px;
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    animation: dcb-pulse 1.5s ease infinite;
}
@keyframes dcb-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
.dcb__empty {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    padding: var(--space-3) 0;
}
.dcb__row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: var(--space-3);
    padding: var(--space-1) 0;
    font-size: var(--type-body);
    align-items: baseline;
}
.dcb__label { color: var(--color-text-secondary); display: inline-flex; align-items: center; gap: var(--space-1); }
.dcb__icon { width: var(--icon-size-sm); opacity: 0.8; }
.dcb__icon--grid { color: var(--color-warning); }
.dcb__icon--self { color: var(--color-success); }
.dcb__icon--export { color: var(--color-primary); }
.dcb__value { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.dcb__kg { color: var(--color-text-tertiary); font-size: var(--type-caption); font-variant-numeric: tabular-nums; }
.dcb__bar {
    display: flex;
    height: 6px;
    border-radius: var(--radius-xs);
    overflow: hidden;
    margin-top: var(--space-2);
    background: var(--color-surface-3);
}
.dcb__seg { height: 100%; }
.dcb__seg--grid { background: var(--color-warning); opacity: 0.65; }
.dcb__seg--self { background: var(--color-success); opacity: 0.65; }
.dcb__factor {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-top: var(--space-1);
    text-align: right;
}
</style>
