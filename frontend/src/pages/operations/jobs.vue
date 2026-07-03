<template>
    <PageTemplate
        fill
        title="Jobs"
        :tabs="tabs"
        :count="hasJobs ? `${allJobs.length} job${allJobs.length === 1 ? '' : 's'}` : undefined"
        :empty="!hasJobs"
        empty-title="No active or recent jobs"
        empty-sub="Long-running fleet operations (firmware updates, backups, certificate pushes) appear here while they run and shortly after."
    >
        <DataList
            :rows="allJobs"
            :columns="columns"
            row-key="id"
            empty-message="No active or recent jobs."
        >
            <template #cell-label="{row}">
                <span class="ops-job__label">{{ row.label }}</span>
            </template>
            <template #cell-status="{row}">
                <span class="ops-job__status" :class="`ops-job__status--${row.status}`">
                    {{ row.status }}
                </span>
            </template>
            <template #cell-devices="{row}">
                <span class="ops-job__count">{{ jobTotal(row) }}</span>
            </template>
            <template #cell-progress="{row}">
                <div v-if="isActiveJob(row)" class="ops-job__progress">
                    <div class="ops-job__bar-track">
                        <div class="ops-job__bar" :style="{width: `${progressPct(row)}%`}" />
                    </div>
                    <span class="ops-job__counts">
                        {{ row.doneCount }} / {{ jobTotal(row) }}
                        <span v-if="row.failCount > 0" class="ops-job__fail">
                            · {{ row.failCount }} failed
                        </span>
                    </span>
                </div>
                <span v-else class="ops-job__counts ops-job__counts--muted">—</span>
            </template>
            <template #cell-started="{row}">
                <span class="ops-job__time">
                    {{ formatRelative(row.startedAt, now.getTime()) }}
                </span>
            </template>
            <template #cell-actions="{row}">
                <Button
                    v-if="canAbortJob(row)"
                    type="red"
                    size="sm"
                    @click="abortJob(row)"
                >
                    Cancel
                </Button>
                <router-link
                    v-if="isActiveJob(row)"
                    :to="JOB_TYPE_ROUTE[jobType(row)]"
                    class="ops-job__open"
                >
                    Open <i class="fas fa-arrow-up-right-from-square" />
                </router-link>
            </template>
        </DataList>
    </PageTemplate>
</template>

<script setup lang="ts">
import {useNow} from '@vueuse/core';
import {type ComputedRef, computed, inject} from 'vue';
import Button from '@/components/core/Button.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {OPS_REFRESH_MS} from '@/constants';
import {formatRelative} from '@/helpers/format';
import {
    type JobRecord,
    type JobType,
    useBackgroundOpsStore
} from '@/stores/backgroundOps';
import {
    type BackendJobKind,
    type BackendJobRecord,
    useJobsStore
} from '@/stores/jobs';
import type {RouteTab} from '@/types/page-template';

type OperationsJob = BackendJobRecord | JobRecord;

// Each job type opens the page that owns its workflow.
const JOB_TYPE_ROUTE: Record<BackendJobKind | JobType, string> = {
    firmware: '/operations/firmware',
    backup: '/operations/backups',
    certificate: '/operations/device-auth/certificates',
    credential: '/operations/device-auth'
};

const opsStore = useBackgroundOpsStore();
const jobsStore = useJobsStore();
const now = useNow({interval: OPS_REFRESH_MS});

const tabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'operationsTabs',
    [] as RouteTab[]
);

const allJobs = computed(() =>
    [...jobsStore.allJobs, ...Array.from(opsStore.jobs.values())].sort(
        (a, b) => b.startedAt - a.startedAt
    )
);
const hasJobs = computed(() => allJobs.value.length > 0);

function jobType(job: OperationsJob): BackendJobKind | JobType {
    return 'kind' in job ? job.kind : job.type;
}

function jobTotal(job: OperationsJob): number {
    return 'total' in job ? job.total : job.deviceIds.length;
}

function isActiveJob(job: OperationsJob): boolean {
    return job.status === 'queued' || job.status === 'running';
}

function progressPct(job: OperationsJob): number {
    const total = jobTotal(job);
    if (total === 0) return 0;
    return Math.round(((job.doneCount + job.failCount) / total) * 100);
}

function canAbortJob(job: OperationsJob): boolean {
    return isActiveJob(job) && !('kind' in job);
}

function abortJob(job: OperationsJob): void {
    if ('kind' in job) return;
    opsStore.abortJob(job.id);
}

const columns: DataColumn<OperationsJob>[] = [
    {key: 'label', label: 'Job'},
    {key: 'status', label: 'Status'},
    {key: 'devices', label: 'Devices', align: 'right'},
    {key: 'progress', label: 'Progress'},
    {key: 'started', label: 'Started'},
    {key: 'actions', label: '', align: 'right'}
];
</script>

<style scoped>
/* Job label: prominent, but inline with row rhythm. */
.ops-job__label {
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
    color: var(--color-text-primary);
}

/* Status pill — re-uses the existing status palette. */
.ops-job__status {
    display: inline-block;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
}
.ops-job__status--running {
    background: rgba(var(--color-status-on-rgb), 0.12);
    color: var(--color-status-on);
}
.ops-job__status--queued {
    background: rgba(var(--color-status-on-rgb), 0.08);
    color: var(--color-status-on);
}
.ops-job__status--done {
    background: var(--color-success-subtle);
    color: var(--color-success-text);
}
.ops-job__status--failed {
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
.ops-job__status--cancelled {
    background: rgba(var(--color-frost-rgb), 0.1);
    color: var(--color-text-tertiary);
}

.ops-job__count {
    font-variant-numeric: tabular-nums;
    color: var(--color-text-secondary);
}

.ops-job__progress {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 160px;
}
.ops-job__bar-track {
    flex: 1;
    height: var(--space-1);
    background: var(--color-surface-3);
    border-radius: var(--radius-full);
    overflow: hidden;
}
.ops-job__bar {
    height: 100%;
    background: var(--color-status-on);
    border-radius: var(--radius-full);
    transition: width var(--duration-moderate) var(--ease-default);
}
.ops-job__counts {
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
}
.ops-job__counts--muted {
    color: var(--color-text-disabled);
}
.ops-job__fail {
    color: var(--color-danger-text);
}

.ops-job__time {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.ops-job__open {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-height: var(--btn-h-sm);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    text-decoration: none;
    margin-left: var(--space-2);
    transition: background-color var(--motion-hover);
}
.ops-job__open:hover {
    background: var(--state-hover-bg);
}
.ops-job__open:hover, .ops-job__open:focus-visible {
    text-decoration: underline;
}
</style>
