<template>
    <div class="dwif">
        <div v-if="loading" class="dwif__skeleton" />
        <template v-else-if="!hasData">
            <div class="dwif__empty">Need consumption data to project.</div>
        </template>
        <template v-else>
            <div class="dwif__kwp-row">
                <label class="dwif__kwp-label" for="dwif-kwp">PV capacity</label>
                <input
                    id="dwif-kwp"
                    v-model.number="addedKwP"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    class="dwif__kwp-input"
                />
                <span class="dwif__kwp-unit">kWp</span>
            </div>
            <div class="dwif__row">
                <span class="dwif__label">Projected generation</span>
                <span class="dwif__value">{{ formatKwh(plan.generation) }} kWh</span>
            </div>
            <div class="dwif__row">
                <span class="dwif__label">Estimated savings</span>
                <span class="dwif__value">{{ currencySymbol }}{{ formatMoney(plan.savings) }}</span>
            </div>
            <div class="dwif__row">
                <span class="dwif__label">Avoided CO₂</span>
                <span class="dwif__value">{{ formatKg(plan.avoidedKg) }} kg</span>
            </div>
            <div class="dwif__hint">
                EU rule-of-thumb 1 kWp ≈ 1000 kWh/year. Capped by your grid imports.
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue';

const props = defineProps<{
    currentGridKWh: number;
    currentTariff: number;
    factorGPerKWh: number;
    periodDays: number;
    currencySymbol: string;
    initialKwP?: number;
    loading?: boolean;
}>();

const YIELD_KWH_PER_KWP_PER_YEAR = 1000;
const DAYS_PER_YEAR = 365;

const addedKwP = ref(props.initialKwP ?? 5);

// Mirrors backend computeWhatIfSolar — pure, no side effects.
const plan = computed(() => {
    const kwp = Number.isFinite(addedKwP.value) && addedKwP.value > 0 ? addedKwP.value : 0;
    if (kwp === 0 || props.periodDays <= 0) {
        return {generation: 0, savings: 0, avoidedKg: 0};
    }
    const generation =
        (kwp * YIELD_KWH_PER_KWP_PER_YEAR * props.periodDays) / DAYS_PER_YEAR;
    const displaceable = Math.min(generation, props.currentGridKWh);
    return {
        generation,
        savings: displaceable * props.currentTariff,
        avoidedKg: (displaceable * props.factorGPerKWh) / 1000
    };
});

const hasData = computed(() => props.currentGridKWh > 0 && props.periodDays > 0);

function formatKwh(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 0});
}
function formatMoney(n: number): string {
    return n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
}
function formatKg(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 1});
}
</script>

<style scoped>
.dwif__skeleton {
    height: 140px;
    background: var(--color-surface-3);
    border-radius: var(--radius-md);
    animation: dwif-pulse 1.5s ease infinite;
}
@keyframes dwif-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
.dwif__empty {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    padding: var(--space-3) 0;
}
.dwif__kwp-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--color-border-subtle);
    margin-bottom: var(--space-2);
}
.dwif__kwp-label { color: var(--color-text-secondary); font-size: var(--type-body); flex: 1; }
.dwif__kwp-input {
    width: 80px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    font-variant-numeric: tabular-nums;
    text-align: right;
}
.dwif__kwp-unit { color: var(--color-text-tertiary); font-size: var(--type-body); }
.dwif__row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: var(--space-1) 0;
    font-size: var(--type-body);
}
.dwif__label { color: var(--color-text-tertiary); }
.dwif__value { color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.dwif__hint {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-top: var(--space-1);
}
</style>
