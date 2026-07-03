<template>
    <PageTemplate title="Database" :tabs="monitoringTabs" back="/monitoring/resources" active-path="/monitoring/resources" fill>
        <h2 class="sr-only">Database</h2>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel < 2"
                title="Set observability to Medium or higher to see database metrics."
                action-label="Enable Medium Monitoring"
                icon="fas fa-database"
                @action="store.changeLevel(2)"
            />

            <MonitoringEmptyState
                v-else-if="store.obsLevel >= 1 && !store.latest"
                title="Waiting for metrics data..."
                loading
            />

            <template v-if="store.obsLevel >= 1 && store.latest">
                <InsightPanel :insights="insights" />

                <BasicBlock darker>
                    <div class="db-stack">
                        <MonitoringStatusSummaryRow
                            :status="store.databaseStatus"
                            title="Connection Pool"
                        />
                        <MonitoringGrid :columns="4">
                            <div class="db-tile">
                                <div class="db-tile-label">Active / Total</div>
                                <span class="db-tile-value">
                                    {{ store.latest.dbPoolTotal - store.latest.dbPoolIdle }} / {{ store.latest.dbPoolTotal }}
                                </span>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Idle</div>
                                <span class="db-tile-value db-text-success">{{ store.latest.dbPoolIdle }}</span>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Waiting</div>
                                <div class="db-tile-row">
                                    <span class="db-tile-value" :class="poolWaitingClass">
                                        {{ store.latest.dbPoolWaiting }}
                                    </span>
                                    <SparkLine :data="cachedHistory.dbPoolWaiting" :color="chartColors.warning" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Avg Query Latency</div>
                                <div class="db-tile-row">
                                    <span class="db-tile-value" :class="durationColor(store.latest.dbAvgMs)">
                                        {{ store.latest.dbAvgMs }}ms
                                    </span>
                                    <SparkLine :data="cachedHistory.dbAvgMs" :color="chartColors.primary" :width="60" :height="20" />
                                </div>
                            </div>
                        </MonitoringGrid>

                        <div class="db-bar">
                            <div
                                class="db-bar-fill db-bar-fill--active"
                                :style="{width: poolActivePercent + '%'}"
                                :title="`Active: ${store.latest.dbPoolTotal - store.latest.dbPoolIdle}`"
                            />
                            <div
                                class="db-bar-fill db-bar-fill--idle"
                                :style="{width: poolIdlePercent + '%'}"
                                :title="`Idle: ${store.latest.dbPoolIdle}`"
                            />
                        </div>
                        <div class="db-bar-legend">
                            <span><span class="db-bar-swatch db-bar-swatch--active" />Active</span>
                            <span><span class="db-bar-swatch db-bar-swatch--idle" />Idle</span>
                        </div>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="db-stack">
                        <MonitoringSectionHeader title="Write Pipelines" />
                        <MonitoringGrid :columns="4">
                            <div class="db-tile">
                                <div class="db-tile-label">Status Queue</div>
                                <span class="db-tile-value" :class="store.latest.statusQueueSize > 100 ? 'db-text-danger' : ''">
                                    {{ store.latest.statusQueueSize }}
                                </span>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Status Flushing</div>
                                <span class="db-tile-value" :class="store.latest.statusFlushing ? 'db-text-warning' : ''">
                                    {{ store.latest.statusFlushing ? 'Yes' : 'No' }}
                                </span>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Audit Queue</div>
                                <span class="db-tile-value" :class="auditQueueClass">
                                    {{ store.latest.auditQueueLength }}
                                </span>
                            </div>
                            <div v-if="store.obsLevel >= 2" class="db-tile">
                                <div class="db-tile-label">Flush Rates</div>
                                <div class="db-flush-rates">
                                    <div class="db-flush-rate">
                                        status:
                                        <span class="db-flush-rate-val">{{ store.counterRates.status_flushes ?? 0 }}/min</span>
                                    </div>
                                    <div class="db-flush-rate">
                                        audit:
                                        <span class="db-flush-rate-val">{{ store.counterRates.audit_flushes ?? 0 }}/min</span>
                                    </div>
                                </div>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Last Flush Duration</div>
                                <div class="db-tile-row">
                                    <span class="db-tile-value" :class="flushDurationColor(store.latestMetrics?.modules?.statusQueue?.lastFlushMs ?? 0)">
                                        {{ store.latestMetrics?.modules?.statusQueue?.lastFlushMs ?? 0 }}ms
                                    </span>
                                    <SparkLine :data="cachedHistory.lastFlushMs" :color="chartColors.warning" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Last Flush Batch</div>
                                <span class="db-tile-value">
                                    {{ store.latestMetrics?.modules?.statusQueue?.lastFlushBatchSize ?? 0 }} rows
                                </span>
                            </div>
                            <div class="db-tile">
                                <div class="db-tile-label">Status Cache</div>
                                <span class="db-tile-value">
                                    {{ store.latestMetrics?.modules?.statusQueue?.statusCacheEntries ?? 0 }} entries
                                </span>
                                <div class="db-tile-sub">
                                    {{ store.latestMetrics?.modules?.statusQueue?.statusCacheDevices ?? 0 }} devices
                                </div>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="db-stack">
                        <MonitoringSectionHeader title="Performance Over Time" />
                        <MonitoringGrid :columns="2">
                            <div>
                                <div class="db-chart-label">Pool Waiting Queries</div>
                                <TimeSeriesChart
                                    :data="cachedHistory.dbPoolWaiting"
                                    label="Waiting"
                                    :color="chartColors.warning"
                                    :thresholds="[{value: 1, color: chartColors.warning, label: 'Warning'}, {value: 5, color: chartColors.danger, label: 'Critical'}]"
                                    :height="160"
                                />
                            </div>
                            <div>
                                <div class="db-chart-label">Avg Query Latency</div>
                                <TimeSeriesChart
                                    :data="cachedHistory.dbAvgMs"
                                    label="Avg Latency"
                                    :color="chartColors.primary"
                                    unit="ms"
                                    :thresholds="[{value: 200, color: chartColors.warning, label: 'Warning'}, {value: 500, color: chartColors.danger, label: 'Critical'}]"
                                    :height="160"
                                />
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 2 && store.latestMetrics?.dbTimings" darker>
                    <div class="db-stack">
                        <MonitoringSectionHeader title="DB Query Timings" />
                        <div class="db-scroll db-scroll--xl">
                            <DataList
                                :rows="sortedDbTimings"
                                :columns="dbColumns"
                                row-key="method"
                                empty-message="No DB timings recorded yet"
                                :sort-key="dbSortKey"
                                :sort-asc="dbSortAsc"
                                @sort="sortBy"
                            >
                                <template #cell-avgMs="{row}">
                                    <span :class="durationColor(row.avgMs)">{{ row.avgMs }}</span>
                                </template>
                                <template #cell-maxMs="{row}">
                                    <span :class="durationColor(row.maxMs)">{{ row.maxMs }}</span>
                                </template>
                            </DataList>
                        </div>
                    </div>
                </BasicBlock>
            </template>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject, ref } from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import type {Insight} from '@/components/monitoring/InsightPanel.vue';
import InsightPanel from '@/components/monitoring/InsightPanel.vue';
import MonitoringEmptyState from '@/components/monitoring/MonitoringEmptyState.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import MonitoringStatusSummaryRow from '@/components/monitoring/MonitoringStatusSummaryRow.vue';
import SparkLine from '@/components/monitoring/SparkLine.vue';
import TimeSeriesChart from '@/components/monitoring/TimeSeriesChart.vue';
import {chartColors} from '@/helpers/chartUtils';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const store = useMonitoringStore();

const cachedHistory = computed(() => ({
    dbPoolWaiting: store.historyField('dbPoolWaiting'),
    dbAvgMs: store.historyField('dbAvgMs'),
    lastFlushMs: store.historyField('lastFlushMs')
}));

const poolActivePercent = computed(() => {
    if (!store.latest || store.latest.dbPoolTotal === 0) return 0;
    return Math.round(
        ((store.latest.dbPoolTotal - store.latest.dbPoolIdle) /
            store.latest.dbPoolTotal) *
            100
    );
});
const poolIdlePercent = computed(() => {
    if (!store.latest || store.latest.dbPoolTotal === 0) return 0;
    return Math.round(
        (store.latest.dbPoolIdle / store.latest.dbPoolTotal) * 100
    );
});

const poolWaitingClass = computed(() => {
    const v = store.latest?.dbPoolWaiting ?? 0;
    if (v > 5) return 'db-text-danger';
    if (v > 0) return 'db-text-warning';
    return '';
});

const auditQueueClass = computed(() => {
    const v = store.latest?.auditQueueLength ?? 0;
    if (v > 100) return 'db-text-danger';
    if (v > 50) return 'db-text-warning';
    return '';
});

const dbSortKey = ref('method');
const dbSortAsc = ref(true);

interface DbTiming {
    method: string;
    count: number;
    avgMs: number;
    maxMs: number;
}

const dbColumns: DataColumn<DbTiming>[] = [
    {key: 'method', label: 'Method', role: 'primary', sortable: true},
    {key: 'count', label: 'Count', role: 'meta', align: 'right', sortable: true},
    {key: 'avgMs', label: 'Avg ms', role: 'meta', align: 'right', sortable: true},
    {key: 'maxMs', label: 'Max ms', role: 'meta', align: 'right', sortable: true}
];

function sortBy(key: string) {
    if (dbSortKey.value === key) dbSortAsc.value = !dbSortAsc.value;
    else {
        dbSortKey.value = key;
        dbSortAsc.value = true;
    }
}

const sortedDbTimings = computed(() => {
    if (!store.latestMetrics?.dbTimings) return [];
    const entries = Object.entries(store.latestMetrics.dbTimings).map(
        ([method, stats]: [string, any]) => ({
            method,
            ...stats
        })
    );
    const key = dbSortKey.value;
    const asc = dbSortAsc.value;
    entries.sort((a: any, b: any) => {
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'string')
            return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        return asc ? av - bv : bv - av;
    });
    return entries;
});

function durationColor(ms: number): string {
    if (ms > 1000) return 'db-text-danger';
    if (ms > 200) return 'db-text-warning';
    return 'db-text-success';
}

function flushDurationColor(ms: number): string {
    if (ms > 500) return 'db-text-danger';
    if (ms > 200) return 'db-text-warning';
    return '';
}

const insights = computed<Insight[]>(() => {
    const list: Insight[] = [];
    const s = store.latest;
    if (!s) return list;
    if (s.dbPoolWaiting > 5) {
        list.push({
            icon: 'fas fa-database',
            title: 'DB Pool Exhausted',
            description: `${s.dbPoolWaiting} queries waiting for a connection. All ${s.dbPoolTotal} pool connections are active.`,
            action: 'Increase DB pool size, optimize slow queries, or check for connection leaks.',
            severity: 'critical'
        });
    } else if (s.dbPoolWaiting > 0) {
        list.push({
            icon: 'fas fa-database',
            title: 'DB Pool Under Pressure',
            description: `${s.dbPoolWaiting} queries waiting. Pool is approaching capacity.`,
            action: 'Monitor pool usage. If persistent, consider increasing pool size.',
            severity: 'warning'
        });
    }
    if (s.dbAvgMs > 500) {
        list.push({
            icon: 'fas fa-clock',
            title: 'High DB Latency',
            description: `Average query latency is ${s.dbAvgMs}ms. This impacts all DB-dependent operations.`,
            action: 'Check for lock contention, missing indexes, or heavy queries. Inspect DB server load.',
            severity: s.dbAvgMs > 1000 ? 'critical' : 'warning'
        });
    }
    return list;
});
</script>

<style scoped>
.db-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}

.db-tile {
    padding: var(--gap-sm);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-lg);
}
.db-tile-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}
.db-tile-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--gap-xs);
}
.db-tile-value {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.db-tile-sub {
    margin-top: var(--space-0-5);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-disabled);
}

.db-flush-rates {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.db-flush-rate {
    color: var(--color-text-tertiary);
}
.db-flush-rate-val {
    color: var(--color-text-primary);
}

.db-bar {
    width: 100%;
    height: var(--space-3);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-full);
    overflow: hidden;
    display: flex;
}
.db-bar-fill {
    height: 100%;
    transition: width var(--duration-normal);
}
.db-bar-fill--active {
    background-color: var(--color-primary);
}
.db-bar-fill--idle {
    background-color: var(--color-success);
}

.db-bar-legend {
    display: flex;
    gap: var(--gap-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-disabled);
}
.db-bar-swatch {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-xs);
    margin-right: var(--space-1);
}
.db-bar-swatch--active {
    background-color: var(--color-primary);
}
.db-bar-swatch--idle {
    background-color: var(--color-success);
}

.db-chart-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}

.db-scroll {
    overflow: auto;
}
.db-scroll--xl {
    max-height: 20rem;
}

.db-text-success {
    color: var(--color-success-text);
}
.db-text-warning {
    color: var(--color-warning-text);
}
.db-text-danger {
    color: var(--color-danger-text);
}
</style>
