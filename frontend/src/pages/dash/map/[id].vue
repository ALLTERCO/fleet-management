<template>
    <div class="map-dash">
        <WorldMap
            ref="worldMapRef"
            class="map-dash__map"
            :pins="visiblePins"
            :unmapped-locations="unmappedLocations"
            :loading="locationsLoading"
            :hide-controls="true"
            :hide-legend="true"
            :show-nav-control="false"
            :show-attribution="false"
            @pin-click="onPinClick"
            @pin-hover="onPinHover"
        />

        <MapPinTooltip :pin="hoveredPin" :position="hoveredPinPos" />

        <ReconnectBanner />

        <div class="map-dash__top-bar">
            <MapPulseStrip :stats="fleetStats" />
            <div class="map-dash__filters">
                <MapFilterChip
                    v-model="showFilter"
                    label="Show"
                    :options="SHOW_OPTIONS"
                />
                <MapFilterChip
                    v-if="LAYER_OPTIONS.length > 1"
                    v-model="layerFilter"
                    label="Layer"
                    :options="LAYER_OPTIONS"
                />
            </div>
            <div class="map-dash__top-right">
                <MapTimeChips v-model="timeRange" :options="TIME_OPTIONS" />
                <MapSearchBox v-model="searchQuery" placeholder="Search sites…" />
            </div>
        </div>

        <MapAlertBell
            v-model:open="alertRailOpen"
            class="map-dash__bell"
            :alerts="openAlerts"
            :severity="topAlertSeverity"
            :ack-pending="ackPending"
            @select="onAlertSelect"
            @acknowledge="onAlertAcknowledge"
        />

        <MapSitesPanel
            class="map-dash__sites"
            :rows="sitePanelRows"
            :groups="sitePanelGroups"
            @select="onSiteRowSelect"
        />

        <MapScrubberToggle
            class="map-dash__scrubber"
            :active="scrubberOpen"
            label="Replay 24h"
            @toggle="scrubberOpen = !scrubberOpen"
        />

        <MapScrubberBar
            :visible="scrubberOpen"
            past-label="−24h"
            :now-label="`Now · ${nowClock}`"
            :ticks="SCRUBBER_TICKS"
            :playback="timelinePlayback"
            @close="scrubberOpen = false"
        />

        <LocationFocusCard
            v-if="focusedSite && !isMobile"
            :visible="true"
            :site="focusedSite"
            :kpis="focusedKpisDisplay"
            :position="focusCardPosition ?? {left: 0, top: 0}"
            :snooze-pending="snoozePending"
            :snooze-available="snoozeAvailable"
            :live-fallback="liveFallback"
            @open-site="onCardOpenSite"
            @open-floor-plan="onCardOpenFloorPlan"
            @snooze="onCardSnooze"
            @close="closeFocusCard"
        />

        <MapMobileFocusSheet
            v-if="isMobile"
            :site="focusedSite"
            :kpis="mobileKpis"
            @open-site="onCardOpenSite"
            @open-floor-plan="onCardOpenFloorPlan"
            @close="closeFocusCard"
        />

        <MapBuildingStage
            :location="buildingLocation"
            @close="buildingLocationId = null"
            @open-floor="onOpenFloor"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import WorldMap from '@/components/core/maps/WorldMap.vue';
import MapAlertBell from '@/components/dashboard/map/MapAlertBell.vue';
import MapBuildingStage from '@/components/dashboard/map/MapBuildingStage.vue';
import type {
    FilterChipOption
} from '@/components/dashboard/map/MapFilterChip.vue';
import MapFilterChip from '@/components/dashboard/map/MapFilterChip.vue';
import MapMobileFocusSheet, {
    type MobileSiteKpis
} from '@/components/dashboard/map/MapMobileFocusSheet.vue';
import MapPinTooltip from '@/components/dashboard/map/MapPinTooltip.vue';
import type {PulseStat} from '@/components/dashboard/map/MapPulseStrip.vue';
import MapPulseStrip from '@/components/dashboard/map/MapPulseStrip.vue';
import type {
    ScrubberTick
} from '@/components/dashboard/map/MapScrubberBar.vue';
import MapScrubberBar from '@/components/dashboard/map/MapScrubberBar.vue';
import MapScrubberToggle from '@/components/dashboard/map/MapScrubberToggle.vue';
import MapSearchBox from '@/components/dashboard/map/MapSearchBox.vue';
import MapSitesPanel from '@/components/dashboard/map/MapSitesPanel.vue';
import type {
    TimeChipOption
} from '@/components/dashboard/map/MapTimeChips.vue';
import MapTimeChips from '@/components/dashboard/map/MapTimeChips.vue';
import ReconnectBanner from '@/components/dashboard/map/ReconnectBanner.vue';
import LocationFocusCard from '@/components/locations/LocationFocusCard.vue';
import {useFleetPulse} from '@/composables/useFleetPulse';
import {
    type MapPinProjector,
    useLocationFocusCard
} from '@/composables/useLocationFocusCard';
import {useLocationStatus} from '@/composables/useLocationStatus';
import {useMediaQuery} from '@/composables/useMediaQuery';
import {useOpenAlerts} from '@/composables/useOpenAlerts';
import {usePinAlertCounts} from '@/composables/usePinAlertCounts';
import {
    type SitePanelRow,
    useSitePanelRows
} from '@/composables/useSitePanelRows';
import {useTimelinePlayback} from '@/composables/useTimelinePlayback';
import {locationMapState} from '@/helpers/locationMapState';
import {filterPinsByQuery, filterPinsByStatus} from '@/helpers/mapPinFilter';
import {useAlertsStore} from '@/stores/alerts';
import {useLocationsStore} from '@/stores/locations';
import {trackInteraction} from '@/tools/observability';
import * as ws from '@/tools/websocket';
import type {MapPin, MapStatusFilter} from '@/types/map';

const SHOW_OPTIONS: readonly FilterChipOption[] = [
    {value: 'all', label: 'All sites'},
    {value: 'on', label: 'Online', dot: 'on'},
    {value: 'warn', label: 'Warning', dot: 'warn'},
    {value: 'off', label: 'Offline', dot: 'off'},
    {value: 'alerts', label: 'Has alerts', dot: 'warn'}
] as const;

// Only Status ships; energy/signal/alerts overlays land when Agent 3 wires RPCs.
const LAYER_OPTIONS: readonly FilterChipOption[] = [
    {value: 'status', label: 'Status'}
] as const;

const TIME_OPTIONS: readonly TimeChipOption[] = [
    {value: 'live', label: 'Live', live: true},
    {value: '1h', label: '1h'},
    {value: '24h', label: '24h'},
    {value: '7d', label: '7d'}
] as const;

const SCRUBBER_TICKS: readonly ScrubberTick[] = [];

const route = useRoute();
const router = useRouter();
const store = useLocationsStore();
const alertsStore = useAlertsStore();

const dashboardId = computed(() => Number((route.params as {id: string}).id));
const dashboardName = ref('Map');

const showFilter = ref<MapStatusFilter>('all');
const layerFilter = ref('status');
const timeRange = ref<string>('live');
const searchQuery = ref('');
const alertRailOpen = ref(false);
const scrubberOpen = ref(false);

const isMobile = useMediaQuery('(max-width: 640px)');

// Building stage — opens when the focus card asks for the floor plan.
const buildingLocationId = ref<number | null>(null);
const buildingLocation = computed(() =>
    buildingLocationId.value != null
        ? store.locations[buildingLocationId.value] ?? null
        : null
);

function onOpenFloor(_floorId: number): void {
    // Floor-plan navigation lands in a follow-up; the stage stays open for now.
}

// 24h timeline at 60× speed = 24 minutes of real time per loop.
const TIMELINE_DURATION_MS = 24 * 60 * 60 * 1000;
const timelinePlayback = useTimelinePlayback({
    durationMs: TIMELINE_DURATION_MS,
    initialSpeed: 60,
    initialPosition: 1
});

// 150 ms hover delay — research consensus to avoid tooltip flash on flyby.
const HOVER_DELAY_MS = 150;
const hoveredPin = ref<MapPin | null>(null);
const hoveredPinPos = ref({x: 0, y: 0});
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

function projectHoveredPin(): void {
    const pin = hoveredPin.value;
    if (!pin) return;
    const projected = worldMapRef.value?.project?.([pin.lng, pin.lat]);
    if (projected) hoveredPinPos.value = projected;
}

function onPinHover(pin: MapPin | null): void {
    if (hoverTimer) clearTimeout(hoverTimer);
    if (!pin) {
        hoveredPin.value = null;
        return;
    }
    hoverTimer = setTimeout(() => {
        hoveredPin.value = pin;
        projectHoveredPin();
    }, HOVER_DELAY_MS);
}
const nowTick = ref(Date.now());
const nowClock = computed(() =>
    new Date(nowTick.value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    })
);
let nowInterval: ReturnType<typeof setInterval> | null = null;

const locationsLoading = computed(() => store.loading);
const {health: locationHealth} = useLocationStatus();
const {byLocation: alertsByLocation} = usePinAlertCounts();
const {pulse} = useFleetPulse();
const fleetStats = computed<PulseStat[]>(() => [
    {
        id: 'sites',
        label: 'sites',
        value: pulse.value.sitesOnline,
        total: pulse.value.sitesTotal,
        leading: 'live-dot'
    },
    {
        id: 'devices',
        label: 'devices',
        value: pulse.value.devicesOnline,
        total: pulse.value.devicesTotal,
        leading: 'icon',
        icon: 'fa-circle',
        iconColor: 'on'
    },
    {
        id: 'load',
        label: 'kW',
        value: pulse.value.loadKW,
        decimals: 1,
        leading: 'icon',
        icon: 'fa-bolt',
        iconColor: 'primary'
    },
    {
        id: 'alerts',
        label: 'alerts',
        value: pulse.value.alertCount,
        leading: 'icon',
        icon: 'fa-triangle-exclamation',
        tone: pulse.value.alertCount > 0 ? 'alert' : 'default'
    }
]);
const {rows: sitePanelRows, groups: sitePanelGroups} = useSitePanelRows();
const {open: openAlerts, severity: topAlertSeverity} = useOpenAlerts();
const mapState = computed(() =>
    locationMapState(
        Object.values(store.locations),
        locationHealth.value,
        alertsByLocation.value
    )
);
const mapPins = computed(() => mapState.value.pins);
const unmappedLocations = computed(() => mapState.value.unmapped);
const visiblePins = computed(() =>
    filterPinsByQuery(
        filterPinsByStatus(mapPins.value, showFilter.value),
        searchQuery.value
    )
);

const worldMapRef = ref<MapPinProjector | null>(null);

const {
    focusedSite,
    focusedKpisDisplay,
    liveFallback,
    focusCardPosition,
    snoozePending,
    snoozeAvailable,
    onPinClick,
    onCardOpenSite,
    onCardOpenFloorPlan,
    onCardSnooze,
    closeFocusCard
} = useLocationFocusCard({
    worldMapRef,
    route,
    router,
    config: {
        telemetryScope: 'map_dash',
        // Page owns the Esc cascade (stage → scrubber → rail → focus card).
        handleEscape: false,
        onOpenSite: async (id) => {
            await router.push({
                path: '/organize/locations',
                query: {selected: String(id)}
            });
        },
        onOpenFloorPlan: async (id) => {
            buildingLocationId.value = id;
        }
    }
});

const mobileKpis = computed<MobileSiteKpis | null>(() => {
    const snap = focusedKpisDisplay.value;
    if (!snap) return null;
    return {
        online: snap.on,
        total: snap.total,
        powerKW: snap.powerKW,
        alerts: snap.alerts ?? 0,
        lastSeenTs: snap.lastSeenTs
    };
});

function onSiteRowSelect(row: SitePanelRow): void {
    void onPinClick({id: String(row.id)});
}

function onAlertSelect(alert: {
    source: {subjectType: string; subjectId: string};
}): void {
    if (alert.source.subjectType === 'location') {
        void onPinClick({id: alert.source.subjectId});
    }
    alertRailOpen.value = false;
}

// Track which alert is mid-ack so the row's button shows "Marking…" rather
// than letting the user fire the same RPC twice in a row.
const ackPending = ref<number | null>(null);

async function onAlertAcknowledge(alert: {id: number}): Promise<void> {
    if (ackPending.value === alert.id) return;
    ackPending.value = alert.id;
    try {
        await alertsStore.ackInstance(alert.id);
    } finally {
        ackPending.value = null;
    }
}

// Search "fly to matches" — only narrows the camera when the query is active,
// the result set is meaningfully smaller than the full pin set, and there's
// something to frame.
function shouldFlyToMatches(matches: readonly MapPin[]): boolean {
    if (searchQuery.value.trim().length === 0) return false;
    if (matches.length === 0) return false;
    return matches.length < mapPins.value.length;
}

watch(visiblePins, (next) => {
    if (shouldFlyToMatches(next)) worldMapRef.value?.fitToPins?.(next);
});

// Esc cascade: most-disruptive overlay closes first; ignore when nothing is open.
function closeTopMostOverlay(): boolean {
    if (buildingLocationId.value != null) {
        buildingLocationId.value = null;
        return true;
    }
    if (scrubberOpen.value) {
        scrubberOpen.value = false;
        return true;
    }
    if (alertRailOpen.value) {
        alertRailOpen.value = false;
        return true;
    }
    if (focusedSite.value) {
        void closeFocusCard();
        return true;
    }
    return false;
}

function onEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (closeTopMostOverlay()) event.preventDefault();
}

interface StoredDashboard {
    readonly id: number;
    readonly name?: string;
}

async function loadDashboardName(id: number): Promise<string | null> {
    const stored = await ws.sendRPC<StoredDashboard[]>(
        'FLEET_MANAGER',
        'Storage.GetItem',
        {registry: 'ui', key: 'dashboards'}
    );
    if (!Array.isArray(stored)) return null;
    const record = stored.find((d) => d.id === id);
    return record?.name ?? null;
}

let detachMapMove: (() => void) | null = null;

onMounted(async () => {
    void store.fetchLocations();
    void store.fetchKinds();
    void alertsStore.fetchInstances();
    nowInterval = setInterval(() => {
        nowTick.value = Date.now();
    }, 30_000);
    document.addEventListener('keydown', onEscape);
    detachMapMove =
        worldMapRef.value?.onMapMove?.(projectHoveredPin) ?? null;

    if (!Number.isFinite(dashboardId.value)) {
        const raw = (route.params as Record<string, string | string[]>).id;
        trackInteraction('map_dash', 'invalid_dashboard_id', String(raw));
        return;
    }

    try {
        const name = await loadDashboardName(dashboardId.value);
        if (name) dashboardName.value = name;
    } catch (error) {
        console.error('[map-dash] dashboard name fetch failed', error);
        trackInteraction(
            'map_dash',
            'dashboard_name_fetch_failed',
            String(dashboardId.value)
        );
    }
});

onBeforeUnmount(() => {
    if (nowInterval !== null) clearInterval(nowInterval);
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    document.removeEventListener('keydown', onEscape);
    detachMapMove?.();
});
</script>

<style scoped>
.map-dash {
    position: relative;
    flex: 1;
    min-height: 0;
    background: var(--color-surface-bg);
    overflow: hidden;
    /* Bleed past layout-main padding so the map fills the viewport. */
    margin: calc(-1 * var(--space-2)) calc(-1 * var(--space-3)) -5.5rem;
}
@media (max-height: 799px), (min-width: 1024px) {
    .map-dash {
        margin-bottom: calc(-1 * var(--space-2));
    }
}
.map-dash__map {
    position: absolute;
    inset: 0;
}
.map-dash :deep(.mc-host) {
    border-radius: 0;
}
.map-dash :deep(.maplibregl-ctrl-bottom-right),
.map-dash :deep(.maplibregl-ctrl-bottom-left) {
    display: none;
}

.map-dash__top-bar {
    position: absolute;
    top: var(--space-4);
    left: var(--space-4);
    right: var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    z-index: 4;
}
.map-dash__filters {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    flex-shrink: 0;
}
.map-dash__top-right {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
}

.map-dash__bell {
    position: absolute;
    top: calc(var(--space-4) + 60px);
    left: var(--space-4);
    z-index: 5;
}

.map-dash__sites {
    position: absolute;
    top: calc(var(--space-4) + 60px);
    right: var(--space-4);
    z-index: 3;
    max-height: calc(100% - var(--space-4) * 2 - 60px);
}

.map-dash__scrubber {
    position: absolute;
    bottom: var(--space-4);
    left: var(--space-4);
    z-index: 5;
}

</style>
