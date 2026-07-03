<template>
    <SlowOpsPanel
        title="Struggling Browser Clients"
        rpc-method="System.GetSlowClients"
        empty-text="No struggling clients in this window."
        :columns="columns"
    />
</template>

<script setup lang="ts">
import SlowOpsPanel from '@/components/monitoring/SlowOpsPanel.vue';
import type {SlowOpsColumn, SlowOpsRow} from '@/components/monitoring/slowOps';
import {formatAge} from '@/helpers/format';

function actionLabel(entry: SlowOpsRow): string {
    return entry.action === 'dropped' ? 'Dropped events' : 'Paused (lagging)';
}

const columns: SlowOpsColumn[] = [
    {label: 'Client', value: (e) => String(e.clientId)},
    {
        label: 'Buffered KB',
        cellClass: 'col-num',
        value: (e) => Math.round(Number(e.bufferedBytes) / 1024)
    },
    {
        label: 'Action',
        value: actionLabel,
        rowClass: (e) => (e.action === 'dropped' ? 'col-danger' : undefined)
    },
    {label: 'Age', cellClass: 'col-muted', value: (e) => formatAge(Number(e.ts))}
];
</script>
