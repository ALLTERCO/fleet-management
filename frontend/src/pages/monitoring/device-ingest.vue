<template>
    <PageTemplate title="Device Ingest" :tabs="monitoringTabs" back="/monitoring/activity" active-path="/monitoring/activity" fill>
        <h2 class="sr-only">Device Ingest</h2>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel === 0"
                title="Enable monitoring to see device ingest metrics."
                action-label="Enable Light Monitoring"
                icon="fas fa-satellite-dish"
                @action="store.changeLevel(1)"
            />

            <MonitoringEmptyState
                v-else-if="store.obsLevel >= 1 && !store.latest"
                title="Waiting for metrics data..."
                loading
            />

            <template v-if="store.obsLevel >= 1 && store.latest">
                <InsightPanel :insights="insights" />

                <BasicBlock darker>
                    <div class="di-stack">
                        <MonitoringSectionHeader title="Device Fleet" />
                        <MonitoringGrid :columns="4">
                            <StatCard label="Devices Online" :value="store.latest.devicesTotal" :spark-data="cachedHistory.devicesTotal" :color="chartColors.primary" />
                            <StatCard label="Connect Rate" :value="fmtRate(store.counterRates.devices_connected)" suffix="/min" />
                            <StatCard label="Disconnect Rate" :value="fmtRate(store.counterRates.devices_disconnected)" suffix="/min" :warn="(store.counterRates.devices_disconnected ?? 0) > 10" />
                            <StatCard label="Browser Sessions" :value="store.latest.wsClients" :spark-data="cachedHistory.wsClients" :color="chartColors.chart5" />
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="di-stack">
                        <MonitoringStatusSummaryRow
                            :status="store.deviceIngestStatus"
                            title="Initialization Queue"
                        />
                        <MonitoringGrid :columns="4">
                            <StatCard label="Active Inits" :value="store.latest.initActive" :spark-data="cachedHistory.initActive" :color="chartColors.warning" :warn="store.latest.initActive > 50" :critical="store.latest.initActive > 100" />
                            <StatCard label="Queued" :value="store.latest.initQueued" />
                            <StatCard label="Started/min" :value="fmtRate(store.counterRates.device_inits_started)" />
                            <StatCard label="Failures/min" :value="fmtRate(store.counterRates.device_inits_failed)" :spark-data="cachedHistory.initFailureRate" :color="chartColors.danger" :warn="(store.counterRates.device_inits_failed ?? 0) > 2" :critical="(store.counterRates.device_inits_failed ?? 0) > 10" />
                            <StatCard label="Oldest Held" :value="fmtSecs(store.latest.initOldestHeldMs)" suffix="s" :warn="store.latest.initOldestHeldMs > 30000" :critical="store.latest.initOldestHeldMs > 90000" />
                            <StatCard label="Oldest Queued" :value="fmtSecs(store.latest.initOldestQueuedMs)" suffix="s" :warn="store.latest.initOldestQueuedMs > 10000" :critical="store.latest.initOldestQueuedMs > 30000" />
                            <StatCard label="Reclaimed" :value="store.latest.initReclaimedTotal" :warn="store.latest.initReclaimedTotal > 0" />
                            <StatCard label="Slow Builds" :value="store.latest.buildSlowCount" :warn="store.latest.buildSlowCount > 0" />
                            <StatCard label="Slowest Build" :value="fmtSecs(store.latest.buildSlowestMs)" suffix="s" :warn="store.latest.buildSlowestMs > 10000" :critical="store.latest.buildSlowestMs > 30000" />
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="di-stack">
                        <MonitoringSectionHeader title="Init Activity Over Time" />
                        <MonitoringGrid :columns="2">
                            <div>
                                <div class="di-chart-label">Active Inits (of 100 max)</div>
                                <TimeSeriesChart
                                    :data="cachedHistory.initActive"
                                    label="Active Inits"
                                    :color="chartColors.warning"
                                    :thresholds="[{value: 50, color: chartColors.warning, label: 'Warning'}, {value: 80, color: chartColors.danger, label: 'Critical'}]"
                                    :height="160"
                                />
                            </div>
                            <div>
                                <div class="di-chart-label">Init Failures per Minute</div>
                                <TimeSeriesChart
                                    :data="cachedHistory.initFailureRate"
                                    label="Failures/min"
                                    :color="chartColors.danger"
                                    unit="/min"
                                    :thresholds="[{value: 2, color: chartColors.warning, label: 'Warning'}, {value: 10, color: chartColors.danger, label: 'Critical'}]"
                                    :height="160"
                                />
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 2" darker>
                    <div class="di-stack">
                        <MonitoringSectionHeader title="Device Counters" />
                        <MonitoringGrid :columns="5">
                            <div v-for="key in deviceCounterKeys" :key="key" class="di-counter-card">
                                <span class="di-counter-label">{{ key }}:</span>
                                <span class="di-counter-value">{{ store.latestMetrics?.counters?.[key] ?? 0 }}</span>
                                <span v-if="store.counterRates[key]" class="di-counter-rate">
                                    (+{{ store.counterRates[key] }}/min)
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 2 && initDurations.length > 0" darker>
                    <div class="di-stack">
                        <MonitoringSectionHeader
                            title="Recent Init Durations"
                            :description="`last ${initDurations.length}`"
                        />
                        <MonitoringGrid :columns="4">
                            <StatCard label="Avg Duration" :value="`${initDurationStats.avg}ms`" />
                            <StatCard label="Max Duration" :value="`${initDurationStats.max}ms`" :warn="initDurationStats.max > 5000" />
                            <StatCard label="Min Duration" :value="`${initDurationStats.min}ms`" />
                            <StatCard label="Samples" :value="initDurations.length" />
                        </MonitoringGrid>
                        <div class="di-scroll di-scroll--md">
                            <div v-for="(entry, i) in initDurations" :key="i" class="di-list-row">
                                <span class="di-time">{{ formatTimeOfDay(entry.ts) }}</span>
                                <span class="di-id-text di-id">{{ entry.shellyID }}</span>
                                <span class="di-duration" :class="durationColor(entry.durationMs)">
                                    {{ entry.durationMs }}ms
                                </span>
                            </div>
                        </div>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 2 && initFailures.length > 0" darker>
                    <div class="di-stack">
                        <MonitoringSectionHeader
                            title="Recent Init Failures"
                            :description="`last ${initFailures.length}`"
                        />
                        <div class="di-scroll di-scroll--lg">
                            <div v-for="(entry, i) in initFailures" :key="i" class="di-list-row">
                                <span class="di-time">{{ formatTimeOfDay(entry.ts) }}</span>
                                <span class="di-id-warning di-id">{{ entry.shellyID }}</span>
                                <span class="di-error-text di-error">{{ entry.error }}</span>
                            </div>
                        </div>
                    </div>
                </BasicBlock>
            </template>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject } from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import type {Insight} from '@/components/monitoring/InsightPanel.vue';
import InsightPanel from '@/components/monitoring/InsightPanel.vue';
import MonitoringEmptyState from '@/components/monitoring/MonitoringEmptyState.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import MonitoringStatusSummaryRow from '@/components/monitoring/MonitoringStatusSummaryRow.vue';
import StatCard from '@/components/monitoring/StatCard.vue';
import TimeSeriesChart from '@/components/monitoring/TimeSeriesChart.vue';
import {chartColors} from '@/helpers/chartUtils';
import {formatTimeOfDay} from '@/helpers/format';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const store = useMonitoringStore();

const cachedHistory = computed(() => ({
    devicesTotal: store.historyField('devicesTotal'),
    wsClients: store.historyField('wsClients'),
    initActive: store.historyField('initActive'),
    initFailureRate: store.historyField('initFailureRate')
}));

const deviceCounterKeys = [
    'devices_connected',
    'devices_disconnected',
    'device_inits_started',
    'device_inits_completed',
    'device_inits_failed'
];

const initFailures = computed(() => store.latestMetrics?.initFailures ?? []);

const initDurations = computed(() =>
    [...(store.latestMetrics?.initDurations ?? [])].reverse()
);
const initDurationStats = computed(() => {
    const durations = initDurations.value.map((e: any) => e.durationMs);
    if (durations.length === 0) return {avg: 0, max: 0, min: 0};
    return {
        avg: Math.round(
            durations.reduce((a: number, b: number) => a + b, 0) /
                durations.length
        ),
        max: Math.max(...durations),
        min: Math.min(...durations)
    };
});

function durationColor(ms: number): string {
    if (ms > 5000) return 'di-duration-critical';
    if (ms > 2000) return 'di-duration-warning';
    return 'di-duration-ok';
}

const insights = computed<Insight[]>(() => {
    const list: Insight[] = [];
    const s = store.latest;
    if (!s) return list;
    if (s.initActive > 80) {
        list.push({
            icon: 'fas fa-triangle-exclamation',
            title: 'Init Queue Near Capacity',
            description: `${s.initActive}/100 concurrent init slots in use. ${s.initQueued} devices are queued waiting for a slot.`,
            action: 'Check network connectivity to devices. Consider staggering device reconnections.',
            severity: s.initActive >= 100 ? 'critical' : 'warning'
        });
    }
    if (s.initFailureRate > 2) {
        list.push({
            icon: 'fas fa-xmark-circle',
            title: 'High Init Failure Rate',
            description: `${s.initFailureRate} device initialization failures per minute.`,
            action: 'Check recent init failures below. Common causes: firmware mismatch, network timeout, DB errors.',
            severity: s.initFailureRate > 10 ? 'critical' : 'warning'
        });
    }
    if ((store.counterRates.devices_disconnected ?? 0) > 20) {
        list.push({
            icon: 'fas fa-plug-circle-xmark',
            title: 'High Disconnect Rate',
            description: `${store.counterRates.devices_disconnected}/min devices disconnecting.`,
            action: 'Check network stability. A mass disconnect often indicates a network issue or server restart.',
            severity:
                (store.counterRates.devices_disconnected ?? 0) > 50
                    ? 'critical'
                    : 'warning'
        });
    }
    return list;
});

function fmtRate(rate?: number): string | number {
    return rate ?? 0;
}

function fmtSecs(ms?: number): number {
    return Math.round((ms ?? 0) / 1000);
}

</script>

<style scoped>
.di-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}

.di-hint-inline {
    font-weight: var(--font-normal);
}

.di-chart-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}

.di-counter-card {
    padding: var(--gap-xs);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    background-color: var(--color-surface-1);
}
.di-counter-label {
    color: var(--color-text-disabled);
}
.di-counter-value {
    color: var(--color-text-secondary);
    margin-left: var(--gap-xs);
}
.di-counter-rate {
    color: var(--color-primary-text);
    margin-left: var(--gap-xs);
}

.di-scroll {
    overflow: auto;
}
.di-scroll--md {
    max-height: 12rem;
}
.di-scroll--lg {
    max-height: 16rem;
}

.di-list-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--space-1-5) 0;
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-bottom: 1px solid color-mix(in srgb, var(--color-border-subtle) 50%, transparent);
}

.di-time {
    color: var(--color-text-disabled);
    width: 4rem;
    flex-shrink: 0;
}

.di-id {
    flex-shrink: 0;
}
.di-id-text {
    color: var(--color-primary-text);
}
.di-id-warning {
    color: var(--color-orange-text);
}

.di-error {
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.di-duration {
    margin-left: auto;
    text-align: right;
    font-weight: var(--font-semibold);
}
.di-duration-critical {
    color: var(--color-danger-text);
}
.di-duration-warning {
    color: var(--color-warning-text);
}
.di-duration-ok {
    color: var(--color-success-text);
}
</style>
