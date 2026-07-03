<template>
    <div class="dash-fleet-summary">
        <div v-if="loading" class="dfs-skeleton" />
        <template v-else>
            <div class="dfs-row">
                <span class="dfs-label">Devices</span>
                <span class="dfs-value">{{ onlineDevices }} on &middot; {{ totalDevices - onlineDevices }} off</span>
            </div>
            <div v-if="groups > 0" class="dfs-row">
                <span class="dfs-label">Locations</span>
                <span class="dfs-value">{{ groups }} groups</span>
            </div>
            <div v-for="(count, type) in devicesByType" :key="type" class="dfs-row">
                <span class="dfs-label">{{ typeLabels[type] ?? type }}</span>
                <span class="dfs-value">{{ count }} devices</span>
            </div>
            <div v-if="avgCostPerDay != null" class="dfs-row">
                <span class="dfs-label">Avg cost/day</span>
                <span class="dfs-value">{{ formatCost(avgCostPerDay) }}</span>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
const props = defineProps<{
    totalDevices: number;
    onlineDevices: number;
    groups: number;
    devicesByType: Record<string, number>;
    avgCostPerDay?: number;
    currencySymbol?: string;
    loading?: boolean;
}>();

const typeLabels: Record<string, string> = {
    '3ph_em': '3-phase EM',
    mono_em: 'Mono EM',
    switch: 'Switches',
    pm: 'Power meters',
    sensor: 'Sensors'
};

function formatCost(n: number): string {
    const sym = props.currencySymbol ?? '\u20AC';
    return `${sym}${n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
}
</script>

<style scoped>
.dfs-skeleton { height: 100px; background: var(--color-surface-3); border-radius: var(--radius-md); animation: dfs-pulse 1.5s ease infinite; }
@keyframes dfs-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
.dfs-row { display: flex; justify-content: space-between; font-size: var(--type-body); padding: 3px 0; border-bottom: 1px solid var(--color-border-subtle); }
.dfs-row:last-child { border-bottom: none; }
.dfs-label { color: var(--color-text-tertiary); }
.dfs-value { color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
</style>
