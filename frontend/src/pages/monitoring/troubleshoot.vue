<template>
    <PageTemplate title="Troubleshoot" :tabs="monitoringTabs" back="/monitoring/investigate" active-path="/monitoring/investigate" fill>
        <template #actions>
            <Button
                :type="store.parsed ? 'blue' : 'blue-hollow'"
                size="sm"
                @click="store.setParsed(!store.parsed)"
            >
                Smart parse {{ store.parsed ? 'ON' : 'OFF' }}
            </Button>
            <Button
                :type="showLogs ? 'blue' : 'blue-hollow'"
                size="sm"
                @click="showLogs = !showLogs"
            >
                FM logs {{ showLogs ? 'ON' : 'OFF' }}
            </Button>
            <Button
                :type="autoScroll ? 'blue' : 'blue-hollow'"
                size="sm"
                @click="autoScroll = !autoScroll"
            >
                Auto-scroll {{ autoScroll ? 'ON' : 'OFF' }}
            </Button>
            <Button type="blue-hollow" size="sm" @click="loadHistory">
                Load history
            </Button>
            <Button type="blue-hollow" size="sm" @click="clearAll">Clear</Button>
        </template>

        <ErrorBoundary>
            <div class="ts-layout">
                <aside class="ts-devices">
                    <div class="ts-devices__head">
                        <span>Watch devices ({{ watchedIds.length }})</span>
                        <button
                            type="button"
                            class="ts-link"
                            @click="watchedIds = []"
                        >
                            none
                        </button>
                    </div>
                    <input
                        v-model="deviceFilter"
                        class="ts-search"
                        placeholder="Filter devices…"
                    />
                    <ul class="ts-device-list">
                        <li v-for="dev in filteredDevices" :key="dev.shellyID">
                            <label class="ts-device">
                                <input
                                    type="checkbox"
                                    :checked="watchedIds.includes(dev.shellyID)"
                                    @change="toggleDevice(dev.shellyID)"
                                />
                                <span class="ts-device__name">{{ dev.name }}</span>
                                <span class="ts-device__id">{{ dev.shellyID }}</span>
                            </label>
                        </li>
                    </ul>
                </aside>

                <section class="ts-feed">
                    <div v-if="historyError" class="ts-banner">{{ historyError }}</div>
                    <EmptyBlock v-if="feed.length === 0">
                        <template #icon><i class="fas fa-wave-square" /></template>
                        <p class="dp-empty-title">No events yet</p>
                        <p class="dp-empty-sub">
                            Pick a device to watch its changes live, or load history.
                        </p>
                    </EmptyBlock>
                    <div v-else ref="feedEl" class="ts-feed__list">
                        <div
                            v-for="row in feed"
                            :key="row.key"
                            class="ts-row"
                            :class="`ts-row--${row.kind}`"
                        >
                            <span class="ts-row__time" :title="row.timeTitle">
                                {{ row.time }}
                            </span>
                            <span
                                class="ts-row__dot"
                                :style="{background: row.color}"
                            />
                            <span class="ts-row__src">{{ row.tag }}</span>
                            <span class="ts-row__text">{{ row.text }}</span>
                        </div>
                    </div>
                </section>
            </div>
        </ErrorBoundary>
    </PageTemplate>
</template>

<script setup lang="ts">
import {
    type ComputedRef,
    computed,
    inject,
    nextTick,
    ref,
    watch
} from 'vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import {useDeviceEventStream} from '@/composables/useDeviceEventStream';
import {useLogStore} from '@/stores/console';
import {useDeviceEventsStore} from '@/stores/deviceEvents';
import {useDevicesStore} from '@/stores/devices';
import {
    changeColor,
    type DeviceChange,
    rawChange,
    summarizeChange
} from '@/tools/deviceEventFormat';
import {sendRPC} from '@/tools/websocket';
import type {RouteTab} from '@/types/page-template';

interface HistoryRow {
    ts: string;
    received_ts?: string;
    shelly_id: string;
    component: string;
    field: string;
    prev: unknown;
    next: unknown;
    kind: string;
    source: string;
}

interface FeedRow {
    key: string;
    kind: 'device' | 'log' | 'history';
    sortTs: number;
    time: string;
    timeTitle: string;
    color: string;
    tag: string;
    text: string;
}

const monitoringTabs = inject<ComputedRef<RouteTab[]>>('monitoringTabs');
const store = useDeviceEventsStore();
const logStore = useLogStore();
const devicesStore = useDevicesStore();

const watchedIds = ref<string[]>([]);
const deviceFilter = ref('');
const showLogs = ref(false);
const autoScroll = ref(true);
const history = ref<HistoryRow[]>([]);
const historyError = ref('');
const feedEl = ref<HTMLElement>();

// Live subscription follows the watched set (server-side device filter).
useDeviceEventStream(watchedIds);

const filteredDevices = computed(() => {
    const term = deviceFilter.value.trim().toLowerCase();
    const list = devicesStore.getDevices().map((d) => ({
        shellyID: d.shellyID,
        name: devicesStore.getDeviceName(d.shellyID) ?? d.shellyID
    }));
    if (!term) return list;
    return list.filter(
        (d) =>
            d.shellyID.toLowerCase().includes(term) ||
            d.name.toLowerCase().includes(term)
    );
});

function toggleDevice(id: string): void {
    watchedIds.value = watchedIds.value.includes(id)
        ? watchedIds.value.filter((x) => x !== id)
        : [...watchedIds.value, id];
}

// Device-reported time is authoritative; fall back to client receive time only
// when the device sent none. Never rewritten — just labelled.
function formatTime(iso: string | undefined, fallbackMs: number): string {
    const ms = iso ? Date.parse(iso) : fallbackMs;
    return new Date(ms).toLocaleTimeString([], {hour12: false});
}

function renderChangeText(change: DeviceChange): string {
    return store.parsed ? summarizeChange(change) : rawChange(change);
}

interface RowOrigin {
    kind: 'device' | 'history';
    keyPrefix: string;
}

function deviceFeedRow(
    row: {
        seq: number;
        shellyId: string;
        receivedAt: number;
    } & DeviceChange,
    origin: RowOrigin
): FeedRow {
    const sortTs = row.ts ? Date.parse(row.ts) : row.receivedAt;
    return {
        key: `${origin.keyPrefix}-${row.seq}`,
        kind: origin.kind,
        sortTs,
        time: formatTime(row.ts, row.receivedAt),
        timeTitle: row.ts ? `device time ${row.ts}` : 'no device timestamp',
        color: changeColor(row.component),
        tag: row.shellyId,
        text: renderChangeText(row)
    };
}

const liveRows = computed<FeedRow[]>(() =>
    store.events
        .filter((e) => watchedIds.value.includes(e.shellyId))
        .map((e) => deviceFeedRow(e, {kind: 'device', keyPrefix: 'live'}))
);

const historyRows = computed<FeedRow[]>(() =>
    history.value.map((h, i) =>
        deviceFeedRow(
            {...h, shellyId: h.shelly_id, receivedAt: Date.parse(h.ts), seq: i},
            {kind: 'history', keyPrefix: 'hist'}
        )
    )
);

const logRows = computed<FeedRow[]>(() => {
    if (!showLogs.value) return [];
    return logStore.filteredLogs.map((l, i) => ({
        key: `log-${l.ts}-${i}`,
        kind: 'log' as const,
        sortTs: l.ts,
        time: formatTime(undefined, l.ts),
        timeTitle: 'fleet-manager log',
        color: '#94a3b8',
        tag: l.category ?? 'fm',
        text: `${l.coloredPart} ${l.message}`
    }));
});

const feed = computed<FeedRow[]>(() =>
    [...historyRows.value, ...liveRows.value, ...logRows.value].sort(
        (a, b) => a.sortTs - b.sortTs
    )
);

async function loadHistory(): Promise<void> {
    historyError.value = '';
    try {
        const res = await sendRPC<{items: HistoryRow[]}>(
            'FLEET_MANAGER',
            'DeviceEvents.Query',
            {
                shellyIds: watchedIds.value.length ? watchedIds.value : undefined,
                limit: 500
            }
        );
        // Server returns newest-first; the feed sorts by time so order is moot.
        history.value = res?.items ?? [];
    } catch (err) {
        historyError.value =
            err instanceof Error ? err.message : 'Failed to load history';
    }
}

function clearAll(): void {
    store.clear();
    history.value = [];
    historyError.value = '';
}

// Keep the newest event in view while live.
watch(
    () => feed.value.length,
    async () => {
        if (!autoScroll.value) return;
        await nextTick();
        const el = feedEl.value;
        if (el) el.scrollTop = el.scrollHeight;
    }
);
</script>

<style scoped>
.ts-layout {
    display: grid;
    grid-template-columns: 260px 1fr;
    gap: var(--gap-sm, 12px);
    height: 100%;
    min-height: 0;
}
.ts-devices {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-right: 1px solid var(--color-surface-3);
    padding-right: var(--gap-sm, 12px);
    min-height: 0;
}
.ts-devices__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.ts-link {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    font: inherit;
}
.ts-search {
    background: var(--color-surface-2);
    color: var(--color-text-primary);
    border: 1px solid var(--color-surface-3);
    border-radius: var(--radius-sm, 4px);
    padding: 6px 8px;
    font: inherit;
}
.ts-device-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    min-height: 0;
}
.ts-device {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'check name' 'check id';
    column-gap: 8px;
    align-items: center;
    padding: 4px 0;
    cursor: pointer;
}
.ts-device input {
    grid-area: check;
}
.ts-device__name {
    grid-area: name;
    color: var(--color-text-primary);
    font-size: var(--type-caption);
}
.ts-device__id {
    grid-area: id;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-family: var(--font-mono, monospace);
}
.ts-feed {
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.ts-banner {
    padding: 8px 12px;
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-md, 8px);
    font-size: var(--type-caption);
    margin-bottom: 8px;
}
.ts-feed__list {
    overflow-y: auto;
    min-height: 0;
    font-family: var(--font-mono, monospace);
    font-size: var(--type-caption);
}
.ts-row {
    display: grid;
    grid-template-columns: 72px 10px 120px 1fr;
    gap: 8px;
    align-items: center;
    padding: 3px 6px;
    border-bottom: 1px solid var(--color-surface-2);
}
.ts-row--log {
    opacity: 0.8;
}
.ts-row--history {
    background: var(--color-surface-2);
}
.ts-row__time {
    color: var(--color-text-tertiary);
}
.ts-row__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}
.ts-row__src {
    color: var(--color-text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ts-row__text {
    color: var(--color-text-primary);
}
</style>
