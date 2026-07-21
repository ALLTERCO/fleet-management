<template>
    <PageTemplate title="Runtime" :tabs="monitoringTabs" fill>
        <ErrorBoundary>
            <div class="runtime-actions">
                <button type="button" class="runtime-btn" @click="loadRuntime">
                    <i class="fas fa-rotate" aria-hidden="true" />
                    Refresh
                </button>
            </div>

            <BasicBlock darker>
                <div class="runtime-stack">
                    <MonitoringSectionHeader title="Instance" :status="runtimeStatus">
                        <template #actions>
                            <span class="runtime-muted">{{ loadedAtLabel }}</span>
                        </template>
                    </MonitoringSectionHeader>
                    <MonitoringGrid :columns="4">
                        <StatCard label="Version" :value="versionLabel" />
                        <StatCard label="Commit" :value="shortSha(runtimeIdentity.commit)" />
                        <StatCard label="Environment" :value="runtimeIdentity.environment" />
                        <StatCard label="Mode" :value="runtimeIdentity.mode" />
                    </MonitoringGrid>
                    <MonitoringGrid :columns="4">
                        <StatCard label="Client" :value="runtimeIdentity.client" />
                        <StatCard label="Compose" :value="runtimeIdentity.composeProject" />
                        <StatCard label="Manifest" :value="manifestStatusLabel" :warn="manifestStatus === 'not_available'" :critical="manifestStatus === 'invalid' || manifestStatus === 'error'" />
                        <StatCard label="Checksum" :value="manifestChecksumLabel" />
                    </MonitoringGrid>
                </div>
            </BasicBlock>

            <BasicBlock darker>
                <div class="runtime-stack">
                    <MonitoringSectionHeader title="Deploy Checks" />
                    <MonitoringGrid :columns="4">
                        <StatusTile label="Migration" :status="checkStatus('migration')" />
                        <StatusTile label="Smoke" :status="checkStatus('smoke')" />
                        <StatusTile label="API" :status="checkStatus('api')" />
                        <StatusTile label="Browser" :status="checkStatus('browser')" />
                    </MonitoringGrid>
                    <MonitoringGrid :columns="4">
                        <StatCard label="Rollback" :value="rollbackLabel" :warn="rollbackLabel === 'unknown'" />
                        <StatCard label="Generated" :value="manifestGeneratedAt" />
                        <StatCard label="Schema" :value="manifestSchema" />
                        <StatCard label="Revision" :value="manifestRevision" />
                    </MonitoringGrid>
                </div>
            </BasicBlock>

            <BasicBlock darker>
                <div class="runtime-stack">
                    <MonitoringSectionHeader title="Containers" />
                    <MonitoringGrid :columns="5">
                        <StatCard label="Expected" :value="containerSummary.expected" />
                        <StatCard label="Running" :value="containerSummary.running" />
                        <StatCard label="Missing" :value="containerSummary.missing" :warn="containerSummary.missing > 0" />
                        <StatCard label="Unexpected" :value="containerSummary.unexpected" :warn="containerSummary.unexpected > 0" />
                        <StatCard label="Unknown Owner" :value="containerSummary.unknownOwner" :warn="containerSummary.unknownOwner > 0" />
                    </MonitoringGrid>
                    <div v-if="containerRows.length" class="runtime-table-wrap">
                        <DataList
                            :rows="containerRows"
                            :columns="containerColumns"
                            row-key="name"
                            empty-message="No containers recorded"
                        >
                            <template #cell-status="{row}">
                                <span :class="statusClass(row.status)">{{ row.status }}</span>
                            </template>
                        </DataList>
                    </div>
                </div>
            </BasicBlock>

            <BasicBlock darker>
                <div class="runtime-stack">
                    <MonitoringSectionHeader title="Device Usage" />
                    <div v-if="deviceUsageRows.length" class="runtime-table-wrap">
                        <DataList
                            :rows="deviceUsageRows"
                            :columns="deviceUsageColumns"
                            row-key="client_id"
                            empty-message="No device usage rows"
                        >
                            <template #cell-status="{row}">
                                <span :class="usageClass(row)">{{ usageLabel(row) }}</span>
                            </template>
                        </DataList>
                    </div>
                    <div v-else class="runtime-empty">
                        {{ deviceUsageError || 'not_available' }}
                    </div>
                </div>
            </BasicBlock>

            <BasicBlock darker>
                <div class="runtime-stack">
                    <MonitoringSectionHeader title="Contract Payloads" />
                    <details class="runtime-details">
                        <summary>Version</summary>
                        <pre>{{ pretty(versionInfo) }}</pre>
                    </details>
                    <details class="runtime-details">
                        <summary>Deploy manifest</summary>
                        <pre>{{ pretty(manifestPayload) }}</pre>
                    </details>
                    <details class="runtime-details">
                        <summary>Device usage</summary>
                        <pre>{{ pretty(deviceUsagePayload) }}</pre>
                    </details>
                </div>
            </BasicBlock>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    computed,
    defineComponent,
    h,
    inject,
    onMounted,
    ref
} from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import HealthDot from '@/components/monitoring/HealthDot.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import StatCard from '@/components/monitoring/StatCard.vue';
import {
    buildRuntimeContractView,
    type ContainerRow,
    type DeviceUsageRow,
    deployCheckStatus,
    deviceUsageStatusClass,
    deviceUsageStatusLabel,
    redactRuntimePayload,
    type RuntimeRecord,
    runtimeStatusClass,
    shortSha
} from '@/helpers/monitoringRuntime';
import {loadRuntimeContractPayloads} from '@/helpers/monitoringRuntimeClient';
import type {FlowStatus} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const loadedAt = ref<number | null>(null);
const versionInfo = ref<RuntimeRecord>({});
const manifestPayload = ref<RuntimeRecord | null>(null);
const deviceUsagePayload = ref<RuntimeRecord | null>(null);
const manifestError = ref<string | null>(null);
const deviceUsageError = ref<string | null>(null);

const runtimeView = computed(() => {
    return buildRuntimeContractView({
        versionInfo: versionInfo.value,
        manifestPayload: manifestPayload.value,
        manifestError: manifestError.value,
        deviceUsagePayload: deviceUsagePayload.value
    });
});

const versionLabel = computed(() => {
    const version = versionInfo.value.version;
    if (typeof version === 'string' || typeof version === 'number') {
        return version;
    }
    return 'unknown';
});

const manifest = computed(() => runtimeView.value.manifest);
const manifestStatus = computed(() => runtimeView.value.manifestStatus);
const runtimeStatus = computed(() => runtimeView.value.runtimeStatus);
const runtimeIdentity = computed(() => runtimeView.value.runtimeIdentity);
const manifestStatusLabel = computed(() => runtimeView.value.manifestStatusLabel);
const manifestChecksumLabel = computed(
    () => runtimeView.value.manifestChecksumLabel
);
const manifestGeneratedAt = computed(() => runtimeView.value.manifestGeneratedAt);
const manifestSchema = computed(() => runtimeView.value.manifestSchema);
const manifestRevision = computed(() => runtimeView.value.manifestRevision);
const rollbackLabel = computed(() => runtimeView.value.rollbackLabel);
const containerRows = computed(() => runtimeView.value.containerRows);
const containerSummary = computed(() => runtimeView.value.containerSummary);
const deviceUsageRows = computed(() => runtimeView.value.deviceUsageRows);

const loadedAtLabel = computed(() =>
    loadedAt.value ? new Date(loadedAt.value).toLocaleTimeString() : 'not loaded'
);

const containerColumns: DataColumn<ContainerRow>[] = [
    {key: 'name', label: 'Container', role: 'primary'},
    {key: 'image', label: 'Image', role: 'secondary'},
    {key: 'status', label: 'Status', role: 'status'},
    {key: 'client', label: 'Client', role: 'meta'},
    {key: 'environment', label: 'Environment', role: 'meta'},
    {
        key: 'ownerKnown',
        label: 'Owner',
        role: 'status',
        accessor: (row) => (row.ownerKnown ? 'known' : 'unknown')
    }
];

const deviceUsageColumns: DataColumn<DeviceUsageRow>[] = [
    {key: 'client_id', label: 'Client', role: 'primary', accessor: (row) => row.client_id ?? 'unknown'},
    {key: 'environment_id', label: 'Environment', role: 'secondary', accessor: (row) => row.environment_id ?? 'unknown'},
    {key: 'unique_active_devices', label: 'Devices', role: 'meta', align: 'right', accessor: (row) => row.unique_active_devices ?? 0},
    {key: 'paid_device_limit', label: 'Limit', role: 'meta', align: 'right', accessor: (row) => row.paid_device_limit ?? 'unknown'},
    {key: 'usage_percent', label: 'Usage %', role: 'meta', align: 'right', accessor: (row) => row.usage_percent ?? 'unknown'},
    {key: 'status', label: 'Status', role: 'status'}
];

const StatusTile = defineComponent({
    name: 'StatusTile',
    props: {
        label: {type: String, required: true},
        status: {type: String, required: true}
    },
    setup(props) {
        const flowStatus = (): FlowStatus => {
            if (['failed', 'invalid'].includes(props.status)) return 'critical';
            if (['unknown', 'not_available', 'degraded'].includes(props.status))
                return 'warning';
            if (['passed', 'ok', 'running'].includes(props.status))
                return 'healthy';
            return 'unknown';
        };
        return () =>
            h('div', {class: 'runtime-status-tile'}, [
                h('div', {class: 'runtime-status-label'}, props.label),
                h('div', {class: 'runtime-status-row'}, [
                    h(HealthDot, {status: flowStatus()}),
                    h('span', {class: 'runtime-status-value'}, props.status)
                ])
            ]);
    }
});

onMounted(() => {
    void loadRuntime();
});

async function loadRuntime(): Promise<void> {
    const payloads = await loadRuntimeContractPayloads();
    versionInfo.value = payloads.versionInfo;
    manifestPayload.value = payloads.manifestPayload;
    manifestError.value = payloads.manifestError;
    deviceUsagePayload.value = payloads.deviceUsagePayload;
    deviceUsageError.value = payloads.deviceUsageError;
    loadedAt.value = Date.now();
}

function checkStatus(name: string): string {
    return deployCheckStatus(manifest.value, name);
}

function statusClass(status: string): string {
    return runtimeStatusClass(status);
}

function usageClass(row: DeviceUsageRow): string {
    return deviceUsageStatusClass(row);
}

function usageLabel(row: DeviceUsageRow): string {
    return deviceUsageStatusLabel(row);
}

// biome-ignore lint/correctness/noUnusedVariables: exposed to the Vue template.
function pretty(value: unknown): string {
    return JSON.stringify(
        redactRuntimePayload(value ?? {status: 'not_available'}),
        null,
        2
    );
}
</script>

<style scoped>
.runtime-actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: var(--gap-sm);
}
.runtime-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-xs);
    padding: var(--gap-xs) var(--gap-sm);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    font-size: var(--type-caption);
}
.runtime-btn:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-strong);
}
.runtime-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.runtime-row {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.runtime-muted,
.runtime-empty {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.runtime-table-wrap {
    overflow-x: auto;
}
.runtime-status-tile {
    display: flex;
    flex-direction: column;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
}
.runtime-status-label {
    color: var(--color-text-disabled);
    font-size: var(--type-caption);
}
.runtime-status-row {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.runtime-status-value {
    color: var(--color-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
}
.runtime-success {
    color: var(--color-success-text);
}
.runtime-warning {
    color: var(--color-warning-text);
}
.runtime-danger {
    color: var(--color-danger-text);
}
.runtime-details {
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
}
.runtime-details summary {
    cursor: pointer;
    padding: var(--gap-xs) var(--gap-sm);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}
.runtime-details pre {
    margin: 0;
    padding: var(--gap-sm);
    overflow-x: auto;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
</style>
