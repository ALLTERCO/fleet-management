<template>
    <PageTemplate title="Services" :tabs="monitoringTabs" back="/monitoring/activity" active-path="/monitoring/activity" fill>
        <h2 class="sr-only">Services</h2>
        <ErrorBoundary>
            <MonitoringEmptyState
                v-if="store.obsLevel < 1"
                title="Enable monitoring to see service metrics."
                action-label="Enable Light Monitoring"
                icon="fas fa-gears"
                @action="store.changeLevel(1)"
            />

            <MonitoringEmptyState
                v-else-if="store.obsLevel >= 1 && !store.latest"
                title="Waiting for metrics data..."
                loading
            />

            <template v-if="store.obsLevel >= 1 && store.latest">
                <BasicBlock darker>
                    <div class="sv-stack">
                        <MonitoringStatusSummaryRow
                            :status="store.emSyncStatus"
                            title="Energy Meter Sync"
                        />
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">Queue Size</div>
                                <span class="sv-tile-value" :class="emQueueClass">{{ store.latest.emQueueSize }}</span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Active Syncs</div>
                                <div class="sv-tile-row">
                                    <span class="sv-tile-value" :class="emActiveClass">
                                        {{ store.latest.emActiveSyncs }} / 40
                                    </span>
                                    <SparkLine :data="cachedHistory.emActiveSyncs" :color="chartColors.chart7" :width="60" :height="20" />
                                </div>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Oldest Held</div>
                                <span class="sv-tile-value" :class="emOldestClass">{{ emOldestSecs }}s</span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Stuck</div>
                                <span class="sv-tile-value" :class="emStuckClass">{{ store.latest.emSyncStuck }}</span>
                            </div>
                        </MonitoringGrid>
                        <div class="sv-bar">
                            <div
                                class="sv-bar-fill"
                                :class="emBarClass"
                                :style="{width: emConcurrencyPercent + '%'}"
                                :title="`Active: ${store.latest.emActiveSyncs}/40`"
                            />
                        </div>
                        <div class="sv-bar-legend">
                            <span><span class="sv-bar-swatch sv-bar-swatch--orange" />Active Syncs</span>
                            <span class="sv-bar-pct">{{ emConcurrencyPercent }}% capacity</span>
                        </div>

                        <MonitoringSectionHeader title="Redis Buffer Health" />
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">Stream Depth</div>
                                <span class="sv-tile-value" :class="emStreamDepthClass">
                                    {{ store.latest.emSyncStreamDepth }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Oldest Entry</div>
                                <span class="sv-tile-value" :class="emStreamAgeClass">
                                    {{ emStreamAgeSecs }}s
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Pending</div>
                                <span class="sv-tile-value" :class="emPendingClass">
                                    {{ store.latest.emSyncStreamPending }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Rows Written</div>
                                <span class="sv-tile-value">
                                    {{ store.latest.emSyncRowsWrittenPerMin }}/min
                                </span>
                            </div>
                        </MonitoringGrid>
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">Last Write</div>
                                <span class="sv-tile-value" :class="emWriteClass">
                                    {{ store.latest.emSyncLastWriteRows }} rows / {{ emLastWriteMs }}ms
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Write Speed</div>
                                <span class="sv-tile-value">
                                    {{ emRowsPerSec }}/s
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">RPC Fetch</div>
                                <span class="sv-tile-value" :class="emRpcFetchClass">
                                    {{ emRpcFetchMs }}ms / {{ store.latest.emSyncLastRpcRecords }} rows
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Worst Channel Lag</div>
                                <span class="sv-tile-value" :class="emLagClass">
                                    {{ emWorstLagMin }}m · {{ store.latest.emSyncLaggedChannels }} channels
                                </span>
                                <div class="sv-tile-hint">{{ emWorstLagDetail }}</div>
                            </div>
                        </MonitoringGrid>

                        <MonitoringGrid v-if="store.obsLevel >= 2" :columns="4">
                            <div class="sv-counter-card">
                                <span class="sv-counter-label">completed:</span>
                                <span class="sv-counter-value">{{ store.latestMetrics?.counters?.em_syncs_completed ?? 0 }}</span>
                                <span v-if="store.counterRates.em_syncs_completed" class="sv-counter-rate sv-text-success">
                                    (+{{ store.counterRates.em_syncs_completed }}/min)
                                </span>
                            </div>
                            <div class="sv-counter-card">
                                <span class="sv-counter-label">failed:</span>
                                <span class="sv-counter-value">{{ store.latestMetrics?.counters?.em_syncs_failed ?? 0 }}</span>
                                <span v-if="store.counterRates.em_syncs_failed" class="sv-counter-rate sv-text-danger">
                                    (+{{ store.counterRates.em_syncs_failed }}/min)
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="sv-stack">
                        <MonitoringStatusSummaryRow
                            :status="store.databaseStatus"
                            title="Database Runtime"
                        />
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">Version Check</div>
                                <span class="sv-tile-value" :class="dbRuntimeClass">
                                    {{ dbRuntimeLabel }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">PostgreSQL</div>
                                <span class="sv-tile-value">
                                    {{ dbPostgresLabel }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">TimescaleDB</div>
                                <span class="sv-tile-value" :class="dbRuntimeClass">
                                    {{ dbTimescaleLabel }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Last Success</div>
                                <span class="sv-tile-value" :class="dbSuccessAgeClass">
                                    {{ dbLastSuccessLabel }}
                                </span>
                            </div>
                        </MonitoringGrid>
                        <MonitoringGrid :columns="3">
                            <div class="sv-tile">
                                <div class="sv-tile-label">Last Check</div>
                                <span class="sv-tile-value" :class="dbCheckAgeClass">
                                    {{ dbLastCheckLabel }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Expected Image</div>
                                <span class="sv-tile-value sv-tile-value--wrap">
                                    {{ dbExpectedImageLabel }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Runtime Error</div>
                                <span class="sv-tile-value sv-tile-value--wrap" :class="store.latest.dbRuntimeError ? 'sv-text-danger' : ''">
                                    {{ store.latest.dbRuntimeError || 'None' }}
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="sv-stack">
                        <MonitoringStatusSummaryRow
                            :status="store.waitingRoomStatus"
                            title="Waiting Room"
                        />
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">Pending Devices</div>
                                <div class="sv-tile-row">
                                    <span class="sv-tile-value" :class="waitingClass">
                                        {{ store.latest.waitingRoomPending }}
                                    </span>
                                    <SparkLine :data="cachedHistory.waitingRoomPending" :color="chartColors.chart8" :width="60" :height="20" />
                                </div>
                            </div>
                        </MonitoringGrid>
                        <MonitoringGrid v-if="store.obsLevel >= 2" :columns="4">
                            <div class="sv-counter-card">
                                <span class="sv-counter-label">approved:</span>
                                <span class="sv-counter-value">{{ store.latestMetrics?.counters?.waiting_room_approved ?? 0 }}</span>
                                <span v-if="store.counterRates.waiting_room_approved" class="sv-counter-rate sv-text-success">
                                    (+{{ store.counterRates.waiting_room_approved }}/min)
                                </span>
                            </div>
                            <div class="sv-counter-card">
                                <span class="sv-counter-label">denied:</span>
                                <span class="sv-counter-value">{{ store.latestMetrics?.counters?.waiting_room_denied ?? 0 }}</span>
                                <span v-if="store.counterRates.waiting_room_denied" class="sv-counter-rate sv-text-danger">
                                    (+{{ store.counterRates.waiting_room_denied }}/min)
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="sv-stack">
                        <MonitoringSectionHeader title="Discovery & Firmware" />
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">mDNS Scanner</div>
                                <span class="sv-tile-value" :class="store.latest.mdnsRunning ? 'sv-text-success' : 'sv-text-disabled'">
                                    {{ store.latest.mdnsRunning ? 'Running' : 'Stopped' }}
                                </span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Firmware Scheduler</div>
                                <span class="sv-tile-value" :class="store.latest.firmwareRunning ? 'sv-text-success' : 'sv-text-disabled'">
                                    {{ store.latest.firmwareRunning ? 'Running' : 'Stopped' }}
                                </span>
                            </div>
                        </MonitoringGrid>
                        <MonitoringGrid v-if="store.obsLevel >= 2" :columns="4">
                            <div class="sv-counter-card">
                                <span class="sv-counter-label">mdns_discovered:</span>
                                <span class="sv-counter-value">{{ store.latestMetrics?.counters?.mdns_discovered ?? 0 }}</span>
                                <span v-if="store.counterRates.mdns_discovered" class="sv-counter-rate sv-text-primary">
                                    (+{{ store.counterRates.mdns_discovered }}/min)
                                </span>
                            </div>
                        </MonitoringGrid>
                    </div>
                </BasicBlock>

                <BasicBlock darker>
                    <div class="sv-stack">
                        <MonitoringSectionHeader title="Registry Cache" />
                        <MonitoringGrid :columns="4">
                            <div class="sv-tile">
                                <div class="sv-tile-label">File Cache</div>
                                <span class="sv-tile-value">{{ store.latestMetrics?.modules?.registry?.fileCacheSize ?? 0 }}</span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">DB Result Cache</div>
                                <span class="sv-tile-value">{{ store.latestMetrics?.modules?.registry?.dbCacheSize ?? 0 }}</span>
                            </div>
                            <div class="sv-tile">
                                <div class="sv-tile-label">Combined</div>
                                <div class="sv-tile-row">
                                    <span class="sv-tile-value">{{ store.latest.registryCacheSize }}</span>
                                    <SparkLine :data="cachedHistory.registryCacheSize" :color="chartColors.warning" :width="60" :height="20" />
                                </div>
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
    emActiveSyncs: store.historyField('emActiveSyncs'),
    waitingRoomPending: store.historyField('waitingRoomPending'),
    registryCacheSize: store.historyField('registryCacheSize')
}));

const emConcurrencyPercent = computed(() => {
    if (!store.latest) return 0;
    return Math.round((store.latest.emActiveSyncs / 40) * 100);
});

const emQueueClass = computed(() => {
    const v = store.latest?.emQueueSize ?? 0;
    if (v > 200) return 'sv-text-danger';
    if (v > 50) return 'sv-text-warning';
    return '';
});
const emActiveClass = computed(() => {
    const v = store.latest?.emActiveSyncs ?? 0;
    if (v >= 40) return 'sv-text-danger';
    if (v > 30) return 'sv-text-warning';
    return '';
});
const emOldestSecs = computed(() =>
    Math.round((store.latest?.emSyncOldestHeldMs ?? 0) / 1000)
);
const emStreamAgeSecs = computed(() =>
    Math.round((store.latest?.emSyncStreamOldestAgeMs ?? 0) / 1000)
);
const emLastWriteMs = computed(() =>
    Math.round(store.latest?.emSyncLastWriteMs ?? 0)
);
const emRowsPerSec = computed(() =>
    Math.round(store.latest?.emSyncLastWriteRowsPerSec ?? 0)
);
const emRpcFetchMs = computed(() =>
    Math.round(store.latest?.emSyncLastRpcFetchMs ?? 0)
);
const emWorstLagMin = computed(() =>
    Math.round((store.latest?.emSyncWorstChannelLagSec ?? 0) / 60)
);
const emWorstLagDetail = computed(() => {
    const deviceId = store.latest?.emSyncWorstLagDeviceId ?? '';
    const channel = store.latest?.emSyncWorstLagChannel ?? -1;
    if (!deviceId || channel < 0) return 'No lagging channel';
    return `${deviceId} · channel ${channel}`;
});
const emOldestClass = computed(() => {
    const v = store.latest?.emSyncOldestHeldMs ?? 0;
    if (v > 90000) return 'sv-text-danger';
    if (v > 30000) return 'sv-text-warning';
    return '';
});
const emStuckClass = computed(() =>
    (store.latest?.emSyncStuck ?? 0) > 0 ? 'sv-text-danger' : ''
);
const emStreamDepthClass = computed(() => {
    const v = store.latest?.emSyncStreamDepth ?? 0;
    if (v > 200000) return 'sv-text-danger';
    if (v > 50000) return 'sv-text-warning';
    return '';
});
const emStreamAgeClass = computed(() => {
    const v = store.latest?.emSyncStreamOldestAgeMs ?? 0;
    if (v > 30 * 60 * 1000) return 'sv-text-danger';
    if (v > 5 * 60 * 1000) return 'sv-text-warning';
    return '';
});
const emPendingClass = computed(() => {
    const v = store.latest?.emSyncStreamPending ?? 0;
    if (v > 10000) return 'sv-text-danger';
    if (v > 1000) return 'sv-text-warning';
    return '';
});
const emWriteClass = computed(() => {
    const v = store.latest?.emSyncLastWriteMs ?? 0;
    if (v > 5000) return 'sv-text-danger';
    if (v > 1500) return 'sv-text-warning';
    return '';
});
const emRpcFetchClass = computed(() => {
    const v = store.latest?.emSyncLastRpcFetchMs ?? 0;
    if (v > 10000) return 'sv-text-danger';
    if (v > 3000) return 'sv-text-warning';
    return '';
});
const emLagClass = computed(() => {
    const v = store.latest?.emSyncWorstChannelLagSec ?? 0;
    if (v > 6 * 3600) return 'sv-text-danger';
    if (v > 3600) return 'sv-text-warning';
    return '';
});
const emBarClass = computed(() => {
    const v = store.latest?.emActiveSyncs ?? 0;
    if (v >= 40) return 'sv-bar-fill--danger';
    if (v > 30) return 'sv-bar-fill--warning';
    return 'sv-bar-fill--orange';
});
const waitingClass = computed(() => {
    const v = store.latest?.waitingRoomPending ?? 0;
    if (v > 100) return 'sv-text-danger';
    if (v > 20) return 'sv-text-warning';
    return '';
});
const dbRuntimeLabel = computed(() => {
    const status = store.latest?.dbRuntimeStatus ?? 'unknown';
    if (status === 'ok') return 'OK';
    if (status === 'stale') return 'Stale extension';
    if (status === 'mismatch') return 'Version mismatch';
    if (status === 'error') return 'Check failed';
    return 'Unknown';
});
const dbRuntimeClass = computed(() => {
    const code = store.latest?.dbRuntimeStatusCode ?? 0;
    if (code === 3 || code === 4) return 'sv-text-danger';
    if (code === 2 || code === 0) return 'sv-text-warning';
    return 'sv-text-success';
});
const dbPostgresLabel = computed(() => {
    const major = store.latest?.dbRuntimePostgresMajor ?? -1;
    const version = store.latest?.dbRuntimePostgresVersion ?? '';
    if (major < 0 && !version) return 'Unknown';
    return version || `PG ${major}`;
});
const dbTimescaleLabel = computed(() => {
    const actual = store.latest?.dbRuntimeTimescaleVersion ?? '';
    const expected = store.latest?.dbRuntimeExpectedTimescaleVersion ?? '';
    if (!actual && !expected) return 'Unknown';
    if (!expected) return `${actual || 'missing'} / expected unknown`;
    return `${actual || 'missing'} / ${expected}`;
});
function compactAge(age: number): string {
    if (age < 0) return 'never';
    if (age < 60) return `${age}s ago`;
    if (age < 3600) return `${Math.round(age / 60)}m ago`;
    return `${Math.round(age / 3600)}h ago`;
}
function formatCheckTime(value: string): string {
    if (!value) return 'Never';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
}
const dbLastCheckLabel = computed(() => {
    const age = store.latest?.dbRuntimeCheckAgeSec ?? -1;
    return `${formatCheckTime(store.latest?.dbRuntimeCheckedAt ?? '')} (${compactAge(age)})`;
});
const dbLastSuccessLabel = computed(() => {
    const age = store.latest?.dbRuntimeLastSuccessfulAgeSec ?? -1;
    return `${formatCheckTime(store.latest?.dbRuntimeLastSuccessfulAt ?? '')} (${compactAge(age)})`;
});
const dbCheckAgeClass = computed(() => {
    const age = store.latest?.dbRuntimeCheckAgeSec ?? -1;
    if (age < 0 || age > 30 * 60) return 'sv-text-danger';
    if (age > 15 * 60) return 'sv-text-warning';
    return '';
});
const dbSuccessAgeClass = computed(() => {
    const age = store.latest?.dbRuntimeLastSuccessfulAgeSec ?? -1;
    if (age < 0 || age > 60 * 60) return 'sv-text-danger';
    if (age > 30 * 60) return 'sv-text-warning';
    return '';
});
const dbExpectedImageLabel = computed(
    () => store.latest?.dbRuntimeExpectedTimescaleImage || 'Unavailable'
);
</script>

<style scoped>
.sv-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-sm);
}

.sv-tile {
    padding: var(--gap-sm);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-lg);
}
.sv-tile-label {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    margin-bottom: var(--gap-xs);
}
.sv-tile-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--gap-xs);
}
.sv-tile-value {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}
.sv-tile-value--wrap {
    overflow-wrap: anywhere;
}
.sv-tile-hint {
    margin-top: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    overflow-wrap: anywhere;
}

.sv-bar {
    width: 100%;
    height: var(--space-3);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-full);
    overflow: hidden;
    display: flex;
}
.sv-bar-fill {
    height: 100%;
    transition: width var(--duration-normal);
}
.sv-bar-fill--orange {
    background-color: var(--color-orange);
}
.sv-bar-fill--warning {
    background-color: var(--color-warning);
}
.sv-bar-fill--danger {
    background-color: var(--color-danger);
}

.sv-bar-legend {
    display: flex;
    gap: var(--gap-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-disabled);
}
.sv-bar-swatch {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-xs);
    margin-right: var(--space-1);
}
.sv-bar-swatch--orange {
    background-color: var(--color-orange);
}

.sv-counter-card {
    padding: var(--gap-xs);
    background-color: var(--color-surface-1);
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
}
.sv-counter-label {
    color: var(--color-text-disabled);
}
.sv-counter-value {
    color: var(--color-text-secondary);
    margin-left: var(--gap-xs);
}
.sv-counter-rate {
    margin-left: var(--gap-xs);
}

.sv-text-success {
    color: var(--color-success-text);
}
.sv-text-warning {
    color: var(--color-warning-text);
}
.sv-text-danger {
    color: var(--color-danger-text);
}
.sv-text-primary {
    color: var(--color-primary-text);
}
.sv-text-disabled {
    color: var(--color-text-disabled);
}
</style>
