<template>
    <div class="dash-loc-breakdown">
        <div v-if="loading" class="dlb-skeleton" />
        <template v-else-if="data.length">
            <div v-for="item in rankedData" :key="item.groupId" class="dlb-row">
                <span class="dlb-name">{{ item.name }}</span>
                <span class="dlb-devices">{{ item.deviceCount }} dev</span>
                <span class="dlb-kwh">{{ formatNum(item.totalKwh) }} kWh</span>
                <div class="dlb-bar">
                    <div class="dlb-fill" :style="{width: item.pct + '%'}" />
                </div>
                <span class="dlb-pct">{{ item.pct }}%</span>
            </div>
        </template>
        <div v-else class="dlb-empty">No location data</div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

export interface LocationData {
    groupId: number;
    name: string;
    totalKwh: number;
    deviceCount: number;
    avgPowerW?: number;
}

const props = defineProps<{
    data: LocationData[];
    loading?: boolean;
}>();

const rankedData = computed(() => {
    const total = props.data.reduce((s, d) => s + d.totalKwh, 0);
    return [...props.data]
        .sort((a, b) => b.totalKwh - a.totalKwh)
        .map((d) => ({
            ...d,
            pct: total > 0 ? Math.round((d.totalKwh / total) * 100) : 0
        }));
});

function formatNum(n: number): string {
    return n.toLocaleString('en-US', {maximumFractionDigits: 1});
}
</script>

<style scoped>
.dlb-skeleton { height: 80px; background: var(--color-surface-3); border-radius: var(--radius-md); animation: dlb-pulse 1.5s ease infinite; }
@keyframes dlb-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.dlb-row { display: flex; align-items: center; gap: var(--space-1-5); padding: 5px 0; border-bottom: 1px solid var(--color-border-subtle); }
.dlb-row:last-child { border-bottom: none; }
.dlb-name { flex: 1; font-size: var(--type-body); color: var(--color-text-secondary); }
.dlb-devices { font-size: var(--type-body); color: var(--color-text-disabled); min-width: 36px; text-align: right; }
.dlb-kwh { font-size: var(--type-body); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; min-width: 55px; text-align: right; }
.dlb-bar { width: 50px; height: 3px; background: var(--color-surface-3); border-radius: var(--radius-xs); overflow: hidden; flex-shrink: 0; }
.dlb-fill { height: 100%; border-radius: var(--radius-xs); background: var(--color-primary); opacity: 0.35; transition: width 0.6s ease; }
.dlb-pct { font-size: var(--type-body); color: var(--color-text-disabled); min-width: 24px; text-align: right; }
.dlb-empty { font-size: var(--type-body); color: var(--color-text-disabled); text-align: center; padding: var(--space-4) 0; }
</style>
