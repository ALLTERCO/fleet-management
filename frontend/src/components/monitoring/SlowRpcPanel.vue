<template>
    <SlowOpsPanel
        title="Slow RPCs"
        rpc-method="System.GetSlowRpcs"
        empty-text="No slow RPCs in this window."
        :columns="columns"
        :row-action="openAuditFor"
    />
</template>

<script setup lang="ts">
import {useRouter} from 'vue-router';
import SlowOpsPanel from '@/components/monitoring/SlowOpsPanel.vue';
import type {SlowOpsColumn, SlowOpsRow} from '@/components/monitoring/slowOps';
import {formatAge} from '@/helpers/format';

const router = useRouter();

const SENDER_TYPE_LABELS: Record<string, string> = {
    user: 'User',
    service_user: 'Service',
    system: 'System'
};

function openAuditFor(entry: SlowOpsRow): void {
    router.push({
        path: '/settings/monitoring/audit-log',
        query: {method: String(entry.method)}
    });
}

const columns: SlowOpsColumn[] = [
    {label: 'Method', value: (e) => String(e.method)},
    {label: 'P95 ms', cellClass: 'col-num', value: (e) => Number(e.p95Ms).toFixed(0)},
    {label: 'Actual ms', cellClass: 'col-num', value: (e) => Number(e.ms).toFixed(0)},
    {label: 'Age', cellClass: 'col-muted', value: (e) => formatAge(Number(e.ts))},
    {label: 'Sender', cellClass: 'col-muted', value: (e) => (e.sender as string) ?? '—'},
    {
        label: 'Type',
        cellClass: 'col-muted',
        value: (e) => SENDER_TYPE_LABELS[String(e.senderType)] ?? String(e.senderType)
    }
];
</script>
