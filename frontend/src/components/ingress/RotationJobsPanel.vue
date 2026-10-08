<template>
    <div class="rjp">
        <div class="rjp__head">
            <h3 class="rjp__title">Rotation jobs</h3>
            <Button
                type="blue-hollow"
                size="sm"
                narrow
                title="Refresh"
                aria-label="Refresh rotation jobs"
                :loading="loading"
                @click="refresh"
            >
                <i class="fas fa-sync-alt" aria-hidden="true" />
            </Button>
        </div>
        <p class="rjp__sub">
            Every key rotation and how far it got. A device restarts once when
            it takes its new address.
        </p>
        <div v-if="error" class="rjp__state rjp__state--error">
            {{ error }}
        </div>
        <div v-else-if="loading && jobs.length === 0" class="rjp__state">
            <Spinner size="sm" /> Loading…
        </div>
        <div v-else-if="jobs.length === 0" class="rjp__state">
            No rotation jobs.
        </div>
        <div v-else class="rjp__table-wrap">
            <table class="rjp__table">
                <thead>
                    <tr>
                        <th>Batch</th>
                        <th>Device</th>
                        <th>State</th>
                        <th>Error</th>
                        <th>Since</th>
                        <th class="rjp__actions" aria-label="Actions" />
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="job in jobs" :key="job.id">
                        <td class="rjp__device rjp__mono" :title="job.batchId">
                            {{ shortId(job.batchId) }}
                        </td>
                        <td
                            class="rjp__device rjp__mono"
                            :title="job.identityId"
                        >
                            {{ deviceLabel(job) }}
                        </td>
                        <td>
                            <Pill :variant="stateVariant(job.state)">
                                {{ stateLabel(job.state) }}
                            </Pill>
                        </td>
                        <td>
                            {{ job.errorCode ? errorLabel(job.errorCode) : '—' }}
                        </td>
                        <td :title="formatTime(job.updatedAt)">
                            {{ formatRelative(job.updatedAt, now) }}
                        </td>
                        <td class="rjp__actions">
                            <Button
                                v-if="canCancel(job.state)"
                                type="red"
                                size="xs"
                                :loading="cancelling === job.id"
                                :aria-label="`Cancel rotation ${shortId(job.id)}`"
                                @click="cancel(job.id)"
                            >
                                Cancel
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div v-if="showPaging" class="rjp__paging">
            <span>{{ pagingLabel }}</span>
            <div class="rjp__paging-actions">
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="!hasPrev"
                    :loading="loading"
                    @click="prev"
                >
                    Prev
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="!hasNext"
                    :loading="loading"
                    @click="next"
                >
                    Next
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount} from 'vue';
import type {RotationJob, RotationJobState} from '@/api/deviceIngressRpc';
import Button from '@/components/core/Button.vue';
import Pill from '@/components/core/Pill.vue';
import Spinner from '@/components/core/Spinner.vue';
import {useNowTicker} from '@/composables/useNowTicker';
import {useRotationJobs} from '@/composables/useRotationJobs';
import {formatRelative, formatTime} from '@/helpers/format';

type PillVariant = 'success' | 'info' | 'danger' | 'neutral';

const STATE_LABELS: Record<RotationJobState, string> = {
    queued: 'Queued',
    sent: 'Sent',
    waiting: 'Waiting for device',
    finalized: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled'
};

const STATE_VARIANTS: Record<RotationJobState, PillVariant> = {
    queued: 'neutral',
    sent: 'info',
    waiting: 'info',
    finalized: 'success',
    failed: 'danger',
    cancelled: 'neutral'
};

const ERROR_LABELS: Record<string, string> = {
    offline: 'Device was offline',
    not_applied: 'Device came back with the old key',
    send_failed: 'Could not send the new address',
    cancelled_by_operator: 'Cancelled'
};

const {
    jobs,
    loading,
    error,
    cancelling,
    total,
    page,
    pageSize,
    hasPrev,
    hasNext,
    load,
    cancel,
    next,
    prev
} = useRotationJobs();
const {now, release} = useNowTicker();
onBeforeUnmount(release);

function shortId(id: string): string {
    return id.slice(0, 8);
}

// The job carries its own device id, so a job on any page names its device.
function deviceLabel(job: RotationJob): string {
    return job.expectedExternalId ?? shortId(job.identityId);
}

function stateLabel(state: RotationJobState): string {
    return STATE_LABELS[state] ?? state;
}

function stateVariant(state: RotationJobState): PillVariant {
    return STATE_VARIANTS[state] ?? 'neutral';
}

function errorLabel(code: string): string {
    return ERROR_LABELS[code] ?? code;
}

function canCancel(state: RotationJobState): boolean {
    return state === 'queued' || state === 'waiting';
}

function refresh(): void {
    void load();
}

// Only when the job list is larger than one page, so a single-page list has no dead controls.
const showPaging = computed(() => total.value > pageSize);

// Counted off the rows actually returned, so the label can never claim more.
const pagingLabel = computed(() => {
    if (jobs.value.length === 0) return `0 of ${total.value}`;
    const from = page.value * pageSize + 1;
    return `${from} to ${from + jobs.value.length - 1} of ${total.value}`;
});

defineExpose({load});
</script>

<style scoped>
/* Same panel language as the Enrollment tokens section on this page. */
.rjp {
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background-color: var(--color-surface-1);
    overflow: hidden;
    padding-bottom: var(--gap-sm);
}
.rjp__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-sm);
    min-height: var(--touch-target-min);
    border-bottom: 1px solid var(--color-border-default);
    background-color: var(--color-surface-2);
}
.rjp__title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}
.rjp__sub {
    margin: 0;
    padding: var(--gap-sm) var(--gap-sm) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.rjp__state {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--gap-md) var(--gap-sm);
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}
.rjp__state--error {
    color: var(--color-danger-text);
}
.rjp__paging {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sm);
    padding: var(--gap-sm) var(--gap-sm) 0;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.rjp__paging-actions {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}

/* The panel clips its corners; the table scrolls sideways on its own. */
.rjp__table-wrap {
    overflow-x: auto;
}
.rjp__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-body);
    margin-top: var(--gap-xs);
}
.rjp__table th {
    padding: var(--gap-xs) var(--gap-sm);
    text-align: left;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
    border-bottom: 1px solid var(--color-border-subtle);
}
.rjp__table td {
    padding: var(--gap-xs) var(--gap-sm);
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--divider-hairline);
    white-space: nowrap;
}
.rjp__table tbody tr:last-child td {
    border-bottom: 0;
}
.rjp__device {
    color: var(--color-text-primary);
}
.rjp__mono {
    font-family: var(--font-mono);
}
/* Holds one control; the table sizes the column to its content. */
.rjp__actions {
    width: 1%;
    text-align: right;
}
</style>
