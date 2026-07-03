<template>
    <PageTemplate title="Events" :tabs="monitoringTabs" back="/monitoring/activity" active-path="/monitoring/activity" fill>
        <h2 class="sr-only">Events & Plugins</h2>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel < 1"
                title="Enable monitoring to see event and plugin metrics."
                action-label="Enable Light Monitoring"
                icon="fas fa-wave-square"
                @action="store.changeLevel(1)"
            />

            <MonitoringEmptyState
                v-else-if="store.obsLevel >= 1 && !store.latest"
                title="Waiting for metrics data..."
                loading
            />

            <template v-if="store.obsLevel >= 1 && store.latest">
                <BasicBlock darker>
                    <div class="ev-stack">
                        <MonitoringStatusSummaryRow
                            :status="store.eventsStatus"
                            title="Event Distributor"
                        />
                        <MonitoringGrid :columns="4">
                            <div class="ev-tile">
                                <div class="ev-tile-label">Listeners</div>
                                <div class="ev-tile-row">
                                    <span class="ev-tile-value" :class="store.latest.eventsListeners > 500 ? 'ev-text-warning' : ''">
                                        {{ store.latest.eventsListeners }}
                                    </span>
                                    <SparkLine :data="cachedHistory.eventsListeners" :color="chartColors.chart5" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Event Types</div>
                                <span class="ev-tile-value">{{ store.latest.eventsTypes }}</span>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Broadcast Rate</div>
                                <div class="ev-tile-row">
                                    <span class="ev-tile-value">{{ store.latest.eventsBroadcastRate }}/min</span>
                                    <SparkLine :data="cachedHistory.eventsBroadcastRate" :color="chartColors.chart5" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Group Cache</div>
                                <span class="ev-tile-value">
                                    {{ store.latestMetrics?.modules?.events?.groupCacheSize ?? '—' }}
                                </span>
                            </div>
                        </MonitoringGrid>
                        <MonitoringGrid :columns="4">
                            <div class="ev-tile">
                                <div class="ev-tile-label">Broadcast Max</div>
                                <div class="ev-tile-row">
                                    <span class="ev-tile-value" :class="broadcastMaxClass">
                                        {{ store.latest.broadcastMaxMs ?? 0 }}ms
                                    </span>
                                    <SparkLine :data="cachedHistory.broadcastMaxMs" :color="chartColors.danger" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Serialize Max</div>
                                <span class="ev-tile-value" :class="(store.latest.serializeMaxMs ?? 0) > 5 ? 'ev-text-warning' : ''">
                                    {{ store.latest.serializeMaxMs ?? 0 }}ms
                                </span>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Max WS Buffer</div>
                                <span class="ev-tile-value" :class="(store.latest.wsMaxBufferedKB ?? 0) > 512 ? 'ev-text-danger' : ''">
                                    {{ store.latest.wsMaxBufferedKB ?? 0 }}KB
                                </span>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Events Filtered</div>
                                <span class="ev-tile-value">{{ store.counterRates.events_filtered ?? 0 }}/min</span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="ev-stack">
                        <MonitoringSectionHeader title="Plugin System" />
                        <MonitoringGrid :columns="4">
                            <div class="ev-tile">
                                <div class="ev-tile-label">Loaded Plugins</div>
                                <span class="ev-tile-value">{{ store.latest.pluginsLoaded }}</span>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Active Workers</div>
                                <span class="ev-tile-value">{{ store.latest.pluginWorkers }}</span>
                            </div>
                            <div class="ev-tile">
                                <div class="ev-tile-label">Commander Components</div>
                                <span class="ev-tile-value">{{ store.latest.commanderComponents }}</span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 2 && hasWsBreakdown" darker>
                    <div class="ev-stack">
                        <MonitoringSectionHeader title="WS Message Types" />
                        <div class="ev-scroll ev-scroll--lg">
                            <DataList
                                :rows="wsBreakdownRows"
                                :columns="wsColumns"
                                row-key="method"
                                empty-message="No messages recorded yet"
                            />
                        </div>
                    </div>
                </BasicBlock>

                <BasicBlock v-if="store.obsLevel >= 2 && hasEventCounters" darker>
                    <div class="ev-stack">
                        <MonitoringSectionHeader title="Event Counters" />
                        <MonitoringGrid :columns="5">
                            <div v-for="[key, rate] in eventCounters" :key="key" class="ev-counter-card">
                                <span class="ev-counter-label">{{ key }}:</span>
                                <span class="ev-counter-value">{{ store.latestMetrics?.counters?.[key] ?? 0 }}</span>
                                <span v-if="rate" class="ev-counter-rate" :class="rate > 0 ? 'ev-rate-active' : 'ev-rate-idle'">
                                    ({{ rate > 0 ? '+' : '' }}{{ rate }}/min)
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>
            </template>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {type ComputedRef, computed, inject } from 'vue';
import BasicBlock from '@/components/core/BasicBlock.vue';
import DataList, {type DataColumn} from '@/components/core/DataList.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import MonitoringEmptyState from '@/components/monitoring/MonitoringEmptyState.vue';
import MonitoringGrid from '@/components/monitoring/MonitoringGrid.vue';
import MonitoringSectionHeader from '@/components/monitoring/MonitoringSectionHeader.vue';
import MonitoringStatusSummaryRow from '@/components/monitoring/MonitoringStatusSummaryRow.vue';
import SparkLine from '@/components/monitoring/SparkLine.vue';
import {chartColors} from '@/helpers/chartUtils';
import {useMonitoringStore} from '@/stores/monitoring';
import type {RouteTab} from '@/types/page-template';

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');

const store = useMonitoringStore();

const cachedHistory = computed(() => ({
    eventsListeners: store.historyField('eventsListeners'),
    eventsBroadcastRate: store.historyField('eventsBroadcastRate'),
    broadcastMaxMs: store.historyField('broadcastMaxMs')
}));

const broadcastMaxClass = computed(() => {
    const v = store.latest?.broadcastMaxMs ?? 0;
    if (v > 10) return 'ev-text-danger';
    if (v > 5) return 'ev-text-warning';
    return '';
});

const wsBreakdown = computed(
    () => store.latestMetrics?.wsMessageBreakdown ?? {}
);
const hasWsBreakdown = computed(
    () => Object.keys(wsBreakdown.value).length > 0
);
const sortedWsBreakdown = computed(() =>
    Object.entries(wsBreakdown.value).sort(
        ([, a], [, b]) => (b as number) - (a as number)
    )
);

interface WsBreakdownRow {
    method: string;
    count: number;
}

const wsBreakdownRows = computed<WsBreakdownRow[]>(() =>
    sortedWsBreakdown.value.map(([method, count]) => ({
        method,
        count: count as number
    }))
);

const wsColumns: DataColumn<WsBreakdownRow>[] = [
    {key: 'method', label: 'Method', role: 'primary'},
    {key: 'count', label: 'Count', role: 'meta', align: 'right'}
];

const EVENT_COUNTER_PREFIXES = ['events_', 'plugin_'];

const eventCounters = computed(() => {
    return Object.entries(store.counterRates)
        .filter(([key]) =>
            EVENT_COUNTER_PREFIXES.some((p) => key.startsWith(p))
        )
        .sort(([a], [b]) => a.localeCompare(b));
});

const hasEventCounters = computed(() => eventCounters.value.length > 0);
</script>

<style scoped>
.ev-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}
.ev-tile {
    padding: var(--gap-sm);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-lg);
}
.ev-tile-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}
.ev-tile-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--gap-xs);
}
.ev-tile-value {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.ev-counter-card {
    padding: var(--gap-xs);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.ev-counter-label {
    color: var(--color-text-disabled);
}
.ev-counter-value {
    color: var(--color-text-secondary);
    margin-left: var(--gap-xs);
}
.ev-counter-rate {
    margin-left: var(--gap-xs);
}
.ev-rate-active {
    color: var(--color-accent-text);
}
.ev-rate-idle {
    color: var(--color-text-disabled);
}

.ev-scroll {
    overflow: auto;
}
.ev-scroll--lg {
    max-height: 16rem;
}

.ev-text-warning {
    color: var(--color-warning-text);
}
.ev-text-danger {
    color: var(--color-danger-text);
}
</style>
