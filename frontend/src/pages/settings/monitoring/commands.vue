<template>
    <PageTemplate title="Commands" :tabs="monitoringTabs" fill>
        <h2 class="sr-only">RPC Commands</h2>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel < 2"
                title="Set observability to Medium or higher to see RPC command metrics."
                action-label="Enable Medium Monitoring"
                icon="fas fa-gauge-high"
                @action="store.changeLevel(2)"
            />

            <EmptyBlock v-else-if="store.obsLevel >= 2 && !store.latestMetrics">
                <Spinner />
                <p class="cmd-empty-text">Waiting for metrics data...</p>
            </EmptyBlock>

            <template v-if="store.obsLevel >= 2 && store.latestMetrics">
                <InsightPanel :insights="insights" />

                <BasicBlock darker>
                    <ConcurrentLoadPanel />
                </BasicBlock>

                <BasicBlock darker>
                    <SlowRpcPanel />
                </BasicBlock>

                <BasicBlock darker>
                    <SlowBuildsPanel />
                </BasicBlock>

                <BasicBlock darker>
                    <SlowClientsPanel />
                </BasicBlock>

                <BasicBlock darker>
                    <div class="cmd-stack">
                        <MonitoringSectionHeader
                            title="RPC Command Health"
                            :status="store.rpcCommandsStatus"
                        />
                        <MonitoringGrid :columns="4">
                            <div class="cmd-tile">
                                <div class="cmd-tile-label">Avg Latency</div>
                                <div class="cmd-tile-row">
                                    <span class="cmd-tile-value" :class="durationColor(store.latest?.rpcAvgMs ?? 0)">
                                        {{ formatMs(store.latest?.rpcAvgMs ?? 0) }}
                                    </span>
                                    <SparkLine :data="cachedHistory.rpcAvgMs" :color="chartColors.success" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="cmd-tile">
                                <div class="cmd-tile-label">Error Rate</div>
                                <div class="cmd-tile-row">
                                    <span class="cmd-tile-value" :class="(store.latest?.rpcErrorRate ?? 0) > 2 ? 'cmd-text-danger' : ''">
                                        {{ store.latest?.rpcErrorRate ?? 0 }}/min
                                    </span>
                                    <SparkLine :data="cachedHistory.rpcErrorRate" :color="chartColors.danger" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="cmd-tile">
                                <div class="cmd-tile-label">Success/min</div>
                                <span class="cmd-tile-value cmd-text-success">{{ store.counterRates.rpc_success ?? 0 }}</span>
                            </div>
                            <div class="cmd-tile">
                                <div class="cmd-tile-label">Errors/min</div>
                                <span class="cmd-tile-value" :class="(store.counterRates.rpc_errors ?? 0) > 0 ? 'cmd-text-danger' : ''">
                                    {{ store.counterRates.rpc_errors ?? 0 }}
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="cmd-stack">
                        <MonitoringSectionHeader title="RPC Timings">
                            <template #actions>
                                <button type="button" class="cmd-reset-btn" @click="resetTimings">Reset</button>
                            </template>
                        </MonitoringSectionHeader>
                        <div class="cmd-scroll cmd-scroll--xl">
                            <DataList
                                :rows="sortedRpcTimings"
                                :columns="rpcColumns"
                                row-key="method"
                                empty-message="No RPC timings recorded yet"
                                :sort-key="rpcSortKey"
                                :sort-asc="rpcSortAsc"
                                @sort="sortBy"
                            >
                                <template #cell-avgMs="{row}">
                                    <span :class="durationColor(row.avgMs)">{{ formatMs(row.avgMs) }}</span>
                                </template>
                                <template #cell-maxMs="{row}">
                                    <span :class="durationColor(row.maxMs)">{{ formatMs(row.maxMs) }}</span>
                                </template>
                            </DataList>
                        </div>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="cmd-stack">
                        <MonitoringSectionHeader title="Performance Over Time" />
                        <MonitoringGrid :columns="2">
                            <div>
                                <div class="cmd-chart-label">RPC Avg Latency</div>
                                <TimeSeriesChart
                                    :data="cachedHistory.rpcAvgMs"
                                    label="Avg Latency"
                                    :color="chartColors.success"
                                    unit="ms"
                                    :thresholds="[{value: 500, color: chartColors.warning, label: 'Warning'}, {value: 1000, color: chartColors.danger, label: 'Critical'}]"
                                    :height="160"
                                />
                            </div>
                            <div>
                                <div class="cmd-chart-label">RPC Error Rate</div>
                                <TimeSeriesChart
                                    :data="cachedHistory.rpcErrorRate"
                                    label="Errors/min"
                                    :color="chartColors.danger"
                                    unit="/min"
                                    :thresholds="[{value: 2, color: chartColors.warning, label: 'Warning'}, {value: 10, color: chartColors.danger, label: 'Critical'}]"
                                    :height="160"
                                />
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="rpcErrors.length > 0" darker>
                    <div class="cmd-stack">
                        <MonitoringSectionHeader
                            title="Recent RPC Errors"
                            :description="`last ${rpcErrors.length}`"
                        />
                        <div class="cmd-scroll cmd-scroll--lg">
                            <div v-for="(entry, i) in rpcErrors" :key="i" class="cmd-list-row">
                                <span class="cmd-time">{{ formatTimeOfDay(entry.ts) }}</span>
                                <span class="cmd-method-error">{{ entry.method }}</span>
                                <span class="cmd-error-msg">{{ entry.error }}</span>
                            </div>
                        </div>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 3 && store.rpcTimings.length > 0" darker>
                    <div class="cmd-stack">
                        <MonitoringSectionHeader title="Frontend RPC Timings" />
                        <div class="cmd-meta-row">
                            <span>WS msg/s: {{ store.wsMessagesPerSec }}</span>
                            <span>Pending RPCs: {{ store.pendingRpcCount }}</span>
                        </div>
                        <div class="cmd-scroll cmd-scroll--md">
                            <div v-for="(entry, i) in clientTimingsReversed" :key="i" class="cmd-list-row cmd-list-row--no-border">
                                <span class="cmd-time">{{ formatTimeOfDay(entry.ts) }}</span>
                                <span class="cmd-method-fill">{{ entry.method }}</span>
                                <span class="cmd-fixed-duration" :class="durationColor(entry.durationMs)">
                                    {{ formatMs(entry.durationMs) }}
                                </span>
                            </div>
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
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import Spinner from '@/components/core/Spinner.vue';
import ConcurrentLoadPanel from '@/components/monitoring/ConcurrentLoadPanel.vue';
import type {Insight} from '@/components/monitoring/InsightPanel.vue';
import InsightPanel from '@/components/monitoring/InsightPanel.vue';
import MonitoringEmptyState from '@/components/monitoring/MonitoringEmptyState.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import SlowBuildsPanel from '@/components/monitoring/SlowBuildsPanel.vue';
import SlowClientsPanel from '@/components/monitoring/SlowClientsPanel.vue';
import SlowRpcPanel from '@/components/monitoring/SlowRpcPanel.vue';
import SparkLine from '@/components/monitoring/SparkLine.vue';
import TimeSeriesChart from '@/components/monitoring/TimeSeriesChart.vue';
import {chartColors} from '@/helpers/chartUtils';
import {formatMs, formatTimeOfDay} from '@/helpers/format';
import {useMonitoringStore} from '@/stores/monitoring';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const store = useMonitoringStore();

const cachedHistory = computed(() => ({
    rpcAvgMs: store.historyField('rpcAvgMs'),
    rpcErrorRate: store.historyField('rpcErrorRate')
}));

const rpcSortKey = ref('method');
const rpcSortAsc = ref(true);

interface RpcTiming {
    method: string;
    count: number;
    avgMs: number;
    maxMs: number;
}

const rpcColumns: DataColumn<RpcTiming>[] = [
    {key: 'method', label: 'Method', role: 'primary', sortable: true},
    {key: 'count', label: 'Count', role: 'meta', align: 'right', sortable: true},
    {key: 'avgMs', label: 'Avg', role: 'meta', align: 'right', sortable: true},
    {key: 'maxMs', label: 'Max', role: 'meta', align: 'right', sortable: true}
];

function sortBy(key: string) {
    if (rpcSortKey.value === key) rpcSortAsc.value = !rpcSortAsc.value;
    else {
        rpcSortKey.value = key;
        rpcSortAsc.value = true;
    }
}

const sortedRpcTimings = computed(() => {
    if (!store.latestMetrics?.rpcTimings) return [];
    const entries = Object.entries(store.latestMetrics.rpcTimings).map(
        ([method, stats]: [string, any]) => ({
            method,
            ...stats
        })
    );
    const key = rpcSortKey.value;
    const asc = rpcSortAsc.value;
    entries.sort((a: any, b: any) => {
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'string')
            return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        return asc ? av - bv : bv - av;
    });
    return entries;
});

const rpcErrors = computed(() => store.latestMetrics?.rpcErrors ?? []);
const clientTimingsReversed = computed(() => [...store.rpcTimings].reverse());

async function resetTimings() {
    await sendRPC('FLEET_MANAGER', 'System.Observability.Reset', {}).catch(
        () => {}
    );
    store.fetchAndRecord();
}

function durationColor(ms: number): string {
    if (ms > 1000) return 'cmd-text-danger';
    if (ms > 200) return 'cmd-text-warning';
    return 'cmd-text-success';
}

const insights = computed<Insight[]>(() => {
    const list: Insight[] = [];
    const s = store.latest;
    if (!s) return list;
    if (s.rpcAvgMs > 1000) {
        list.push({
            icon: 'fas fa-gauge-high',
            title: 'Critical RPC Latency',
            description: `Average RPC latency is ${s.rpcAvgMs}ms. Device commands are severely delayed.`,
            action: 'Check backend load, database latency, and device connectivity. Look for slow command handlers.',
            severity: 'critical'
        });
    } else if (s.rpcAvgMs > 500) {
        list.push({
            icon: 'fas fa-gauge-high',
            title: 'High RPC Latency',
            description: `Average RPC latency is ${s.rpcAvgMs}ms. Commands are taking longer than expected.`,
            action: 'Review slow RPC methods in the timings table below. Check DB query performance.',
            severity: 'warning'
        });
    }
    if (s.rpcErrorRate > 10) {
        list.push({
            icon: 'fas fa-triangle-exclamation',
            title: 'High RPC Error Rate',
            description: `${s.rpcErrorRate} RPC errors/min. Many device commands are failing.`,
            action: 'Check device connectivity, firmware compatibility, and recent RPC errors below.',
            severity: 'critical'
        });
    } else if (s.rpcErrorRate > 2) {
        list.push({
            icon: 'fas fa-triangle-exclamation',
            title: 'Elevated RPC Errors',
            description: `${s.rpcErrorRate} errors/min. Some device commands are failing.`,
            action: 'Review error details below. May indicate device timeouts or unreachable devices.',
            severity: 'warning'
        });
    }
    return list;
});
</script>

<style scoped>
.cmd-disabled {
    text-align: center;
    padding-top: var(--gap-lg);
    padding-bottom: var(--gap-lg);
}
.cmd-disabled-text {
    color: var(--color-text-tertiary);
}
.cmd-enable-btn {
    margin-top: var(--gap-sm);
    padding: var(--gap-xs) var(--gap-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-radius: var(--radius-md);
    background-color: var(--color-warning);
    color: var(--color-warning-text);
    transition: background-color var(--duration-fast);
}
.cmd-enable-btn:hover {
    background-color: var(--color-warning-hover);
}

.cmd-empty-text {
    font-size: var(--type-caption);
    padding-top: var(--gap-xs);
}

.cmd-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.cmd-row {
    display: flex;
    align-items: center;
    gap: var(--gap-xs);
}
.cmd-tile {
    padding: var(--gap-sm);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-lg);
}
.cmd-tile-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}
.cmd-tile-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--gap-xs);
}
.cmd-tile-value {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}

.cmd-reset-btn {
    padding: var(--gap-xs) var(--gap-sm);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast);
}
.cmd-reset-btn:hover {
    background-color: var(--color-surface-3);
}

.cmd-chart-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}

.cmd-meta-row {
    display: flex;
    gap: var(--gap-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-tertiary);
    margin-bottom: var(--gap-xs);
}

.cmd-scroll {
    overflow: auto;
}
.cmd-scroll--md {
    max-height: 12rem;
}
.cmd-scroll--lg {
    max-height: 16rem;
}
.cmd-scroll--xl {
    max-height: 20rem;
}

.cmd-list-row {
    display: flex;
    align-items: center;
    gap: var(--gap-sm);
    padding: var(--space-1-5) 0;
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    border-bottom: 1px solid var(--color-border-default);
}
.cmd-list-row--no-border {
    border-bottom: none;
}

.cmd-time {
    color: var(--color-text-disabled);
    width: 4rem;
    flex-shrink: 0;
}

.cmd-method-error {
    color: var(--color-danger-text);
    flex-shrink: 0;
}
.cmd-method-fill {
    flex: 1;
    color: var(--color-text-secondary);
}

.cmd-error-msg {
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cmd-fixed-duration {
    width: 4rem;
    text-align: right;
    font-weight: var(--font-semibold);
}

.cmd-text-success {
    color: var(--color-success-text);
}
.cmd-text-warning {
    color: var(--color-warning-text);
}
.cmd-text-danger {
    color: var(--color-danger-text);
}
</style>
