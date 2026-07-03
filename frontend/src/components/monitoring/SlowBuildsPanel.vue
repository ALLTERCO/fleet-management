<template>
    <SlowOpsPanel
        title="Slow Device Onboards"
        rpc-method="System.GetSlowBuilds"
        empty-text="No slow onboards in this window."
        :columns="columns"
    />
</template>

<script setup lang="ts">
import SlowOpsPanel from '@/components/monitoring/SlowOpsPanel.vue';
import type {SlowOpsColumn, SlowOpsRow} from '@/components/monitoring/slowOps';
import {formatAge} from '@/helpers/format';

interface StageTiming {
    name: string;
    ms: number;
}

function stages(entry: SlowOpsRow): StageTiming[] {
    return (entry.stages as StageTiming[]) ?? [];
}

// The single most expensive step — what to look at first.
function slowestStage(entry: SlowOpsRow): string {
    const s = stages(entry);
    if (s.length === 0) return '—';
    const worst = s.reduce((a, b) => (b.ms > a.ms ? b : a));
    return `${worst.name} (${worst.ms}ms)`;
}

const columns: SlowOpsColumn[] = [
    {label: 'Device', value: (e) => String(e.shellyID)},
    {label: 'Total ms', cellClass: 'col-num', value: (e) => Number(e.totalMs)},
    {label: 'Slowest stage', value: slowestStage},
    {
        label: 'Breakdown',
        cellClass: 'col-mono',
        value: (e) => stages(e).map((s) => `${s.name}=${s.ms}`).join(' ')
    },
    {label: 'Age', cellClass: 'col-muted', value: (e) => formatAge(Number(e.ts))}
];
</script>
