<template>
    <div class="dash-cost-bd">
        <div v-if="loading" class="dcb-skeleton" />
        <template v-else-if="isSingleTariff">
            <div class="dcb-row dcb-row--total">
                <span class="dcb-label">Total cost</span>
                <span class="dcb-value">{{ currencySymbol }}{{ formatNum(totalCost, 2) }}</span>
            </div>
            <div class="dcb-rate">Tariff: {{ currencySymbol }}{{ settings.tariff }}/kWh</div>
        </template>
        <template v-else>
            <div class="dcb-row">
                <span class="dcb-label">Day ({{ dayLabel }})</span>
                <span class="dcb-value">{{ currencySymbol }}{{ formatNum(dayCost, 2) }}</span>
            </div>
            <div class="dcb-row">
                <span class="dcb-label">Night ({{ nightLabel }})</span>
                <span class="dcb-value">{{ currencySymbol }}{{ formatNum(nightCost, 2) }}</span>
            </div>
            <div class="dcb-div" />
            <div class="dcb-row dcb-row--total">
                <span class="dcb-label">Total</span>
                <span class="dcb-value">{{ currencySymbol }}{{ formatNum(totalCost, 2) }}</span>
            </div>
            <div class="dcb-bar">
                <div class="dcb-seg dcb-seg--day" :style="{width: dayPct + '%'}" />
                <div class="dcb-seg dcb-seg--night" :style="{width: (100 - dayPct) + '%'}" />
            </div>
            <div class="dcb-bar-labels">
                <span>Day {{ dayPct }}%</span>
                <span>Night {{ 100 - dayPct }}%</span>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {currencySymbol as currencySymbolFor} from '@/helpers/currencies';
import {tariffLocalTime} from '@/helpers/liveMetrics';
import type {ConsumptionDataPoint} from '@/stores/energyDashboard';
import type {DashboardSettings} from '@/types/dashboard';

const props = defineProps<{
    settings: DashboardSettings;
    periodData: ConsumptionDataPoint[];
    loading?: boolean;
}>();

const currencySymbol = computed(() =>
    currencySymbolFor(props.settings?.currency)
);

const isSingleTariff = computed(
    () => props.settings?.tariffMode !== 'day_night'
);

const dayStartH = computed(() =>
    Number.parseInt(props.settings?.dayStart?.slice(0, 2) ?? '7', 10)
);
const dayEndH = computed(() =>
    Number.parseInt(props.settings?.dayEnd?.slice(0, 2) ?? '23', 10)
);
const dayLabel = computed(
    () =>
        `${String(dayStartH.value).padStart(2, '0')}\u2013${String(dayEndH.value).padStart(2, '0')}h`
);
const nightLabel = computed(
    () =>
        `${String(dayEndH.value).padStart(2, '0')}\u2013${String(dayStartH.value).padStart(2, '0')}h`
);

const costs = computed(() => {
    let dayCostSum = 0;
    let nightCostSum = 0;
    let totalCostSum = 0;
    const s = props.settings;
    if (!s || !props.periodData?.length) return {day: 0, night: 0, total: 0};

    for (const point of props.periodData) {
        const hour = tariffLocalTime(point.bucket, s.tariffTimezone).hour;
        const isDay = hour >= dayStartH.value && hour < dayEndH.value;
        if (s.tariffMode === 'single' || !s.tariffMode) {
            totalCostSum += point.value * (s.tariff ?? 0);
        } else {
            const rate = isDay ? (s.dayRate ?? 0) : (s.nightRate ?? 0);
            if (isDay) dayCostSum += point.value * rate;
            else nightCostSum += point.value * rate;
        }
    }
    return {
        day: dayCostSum,
        night: nightCostSum,
        total:
            s.tariffMode === 'day_night'
                ? dayCostSum + nightCostSum
                : totalCostSum
    };
});

const dayCost = computed(() => costs.value.day);
const nightCost = computed(() => costs.value.night);
const totalCost = computed(() => costs.value.total);
const dayPct = computed(() => {
    const total = dayCost.value + nightCost.value;
    return total > 0 ? Math.round((dayCost.value / total) * 100) : 50;
});

function formatNum(n: number, dp = 1): string {
    return n.toLocaleString('en-US', {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp
    });
}
</script>

<style scoped>
.dcb-skeleton { height: 80px; background: var(--color-surface-3); border-radius: var(--radius-md); animation: dcb-pulse 1.5s ease infinite; }
@keyframes dcb-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.dcb-row { display: flex; justify-content: space-between; font-size: var(--type-body); padding: var(--space-0-5) 0; }
.dcb-label { color: var(--color-text-tertiary); }
.dcb-value { color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.dcb-row--total .dcb-label { color: var(--color-text-secondary); font-weight: 500; }
.dcb-row--total .dcb-value { color: var(--color-text-primary); font-weight: 500; }
.dcb-div { height: 1px; background: var(--color-border-subtle); margin: var(--space-0-5) 0; }
.dcb-bar { display: flex; height: 5px; border-radius: var(--radius-xs); overflow: hidden; gap: 1px; margin-top: var(--space-1-5); }
.dcb-seg { height: 100%; }
.dcb-seg--day { background: var(--color-primary); opacity: 0.4; border-radius: var(--radius-xs) 0 0 var(--radius-xs); }
.dcb-seg--night { background: var(--color-primary); opacity: 0.15; border-radius: 0 var(--radius-xs) var(--radius-xs) 0; }
.dcb-bar-labels { display: flex; justify-content: space-between; font-size: var(--type-body); color: var(--color-text-disabled); margin-top: var(--space-0-5); }
.dcb-rate { font-size: var(--type-body); color: var(--color-text-tertiary); margin-top: var(--space-1); }
</style>
