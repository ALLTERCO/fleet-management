<template>
    <MapCanvas
        ref="canvasRef"
        :initial="initialViewport"
        :show-nav-control="showNavControl"
        :show-attribution="showAttribution"
        :enable-buildings="false"
        :suppress-minor-labels="true"
        class="wm"
        @mousemove.passive="onCanvasMove"
        @mouseleave="clearHover"
    >
        <template #default="{loaded: mapLoaded}">
            <div v-if="mapLoaded && !loading && pins.length === 0" class="wm-empty">
                <i class="fas fa-location-dot" />
                <p>{{ emptyTitle }}</p>
                <p class="wm-empty-sub">
                    {{ emptyMessage }}
                </p>
                <ul v-if="unmappedPreview.length > 0" class="wm-empty-list">
                    <li
                        v-for="location in unmappedPreview"
                        :key="location.id"
                    >
                        <span>{{ location.name }}</span>
                        <small>{{ location.summary }}</small>
                    </li>
                </ul>
            </div>
            <div v-if="mapLoaded && !hideControls && showZoomChrome" class="wm-controls">
                <button
                    type="button"
                    class="wm-btn"
                    :class="{'wm-btn--active': heatmapOn}"
                    :title="heatmapOn ? 'Hide signal heatmap' : 'Show signal heatmap'"
                    :disabled="heatmapLoading"
                    @click="toggleHeatmap"
                >
                    <i class="fas" :class="heatmapLoading ? 'fa-spinner fa-spin' : 'fa-wifi'" />
                    <span>Signal</span>
                </button>
                <button
                    type="button"
                    class="wm-btn"
                    :class="{'wm-btn--active': densityMode}"
                    :title="densityMode ? 'Show individual pins' : 'Show density (hex bins)'"
                    @click="toggleDensity"
                >
                    <i class="fas fa-th" />
                    <span>Density</span>
                </button>
            </div>
            <div v-if="mapLoaded && !hideLegend && showZoomChrome" class="wm-legend">
                <button
                    v-for="entry in legendEntries"
                    :key="entry.key"
                    type="button"
                    class="wm-legend__chip"
                    :class="{'wm-legend__chip--off': statusFilter && statusFilter !== entry.key}"
                    :title="statusFilter === entry.key ? `Clear ${entry.label} filter` : `Show only ${entry.label}`"
                    @click="toggleFilter(entry.key)"
                >
                    <span class="wm-dot" :class="`wm-dot--${entry.key}`" />
                    <span class="wm-legend__label">{{ entry.label }}</span>
                    <span class="wm-legend__count">{{ entry.count }}</span>
                </button>
            </div>
            <div
                v-if="mapLoaded && hoverPin && hoverPos"
                class="wm-tooltip"
                :style="{transform: `translate(${hoverPos.x}px, ${hoverPos.y}px)`}"
            >
                <div class="wm-tooltip__name">{{ hoverPin.label || hoverPin.id }}</div>
                <div class="wm-tooltip__meta">
                    <span class="wm-dot" :class="`wm-dot--${hoverPin.status ?? 'unknown'}`" />
                    <span>{{ tooltipStatusLabel(hoverPin) }}</span>
                    <span v-if="(hoverPin.alertCount ?? 0) > 0" class="wm-tooltip__alert">
                        · {{ hoverPin.alertCount }} alert{{ hoverPin.alertCount === 1 ? '' : 's' }}
                    </span>
                </div>
            </div>
        </template>
    </MapCanvas>
</template>

<script setup lang="ts">
import {HexagonLayer} from '@deck.gl/aggregation-layers';
import type {LngLatBoundsLike} from 'maplibre-gl';
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import MapCanvas from '@/components/core/maps/MapCanvas.vue';
import {useDeckOverlay} from '@/composables/useDeckOverlay';
import {useRafTime} from '@/composables/useRafTime';
import {
    MAP_FIT_MAX_ZOOM,
    MAP_FIT_PADDING_PX,
    MAP_FLY_DURATION_MS,
    MAP_OVERVIEW_ZOOM,
    MAP_SINGLE_PIN_ZOOM
} from '@/constants';
import {toastRpcError} from '@/helpers/domainErrors';
import type {UnmappedLocation} from '@/helpers/locationMapState';
import {type HeatmapPoint, heatmapLayer} from '@/helpers/map-heatmap';
import {clusterPinLayers, locationPinLayers} from '@/helpers/map-layers';
import {pinBounds, pinPositionSignature} from '@/helpers/mapBounds';
import {type ClusterPoint, clusterPins } from '@/helpers/pinClustering';
import {viridisColorRange} from '@/helpers/viridis';
import {useToastStore} from '@/stores/toast';
import * as ws from '@/tools/websocket';
import {DEFAULT_VIEWPORT, type MapPin, type MapViewport} from '@/types/map';

const props = withDefaults(
    defineProps<{
        pins: MapPin[];
        unmappedLocations?: UnmappedLocation[];
        loading?: boolean;
        hideControls?: boolean;
        hideLegend?: boolean;
        showNavControl?: boolean;
        showAttribution?: boolean;
        /** Threshold; clusters only kick in when pins.length ≥ this number. */
        clusterFrom?: number;
    }>(),
    {
        loading: false,
        unmappedLocations: () => [],
        hideControls: false,
        hideLegend: false,
        showNavControl: true,
        showAttribution: true,
        clusterFrom: 50
    }
);

const emit = defineEmits<{
    pinClick: [pin: MapPin];
    pinHover: [pin: MapPin | null];
}>();

const canvasRef = ref<InstanceType<typeof MapCanvas> | null>(null);

// Status filter via legend chips; null = show all.
type StatusKey = NonNullable<MapPin['status']>;
const STATUS_ORDER: StatusKey[] = ['on', 'warn', 'off', 'unknown'];
const STATUS_LABEL: Record<StatusKey, string> = {
    on: 'Online',
    warn: 'Partial',
    off: 'Offline',
    unknown: 'No devices'
};
const statusFilter = ref<StatusKey | null>(null);
const selectedPinId = ref<string | null>(null);
function toggleFilter(key: StatusKey): void {
    statusFilter.value = statusFilter.value === key ? null : key;
}

const filteredPins = computed<MapPin[]>(() => {
    if (!statusFilter.value) return props.pins;
    const key = statusFilter.value;
    return props.pins.filter((p) => (p.status ?? 'unknown') === key);
});

const statusCounts = computed<Record<StatusKey, number>>(() => {
    const counts: Record<StatusKey, number> = {on: 0, warn: 0, off: 0, unknown: 0};
    for (const pin of props.pins) counts[pin.status ?? 'unknown']++;
    return counts;
});

const legendEntries = computed(() =>
    STATUS_ORDER.map((key) => ({
        key,
        label: STATUS_LABEL[key],
        count: statusCounts.value[key]
    }))
);

// Hover tooltip — anchored to mouse, content from the picked pin.
const hoverPin = ref<MapPin | null>(null);
const hoverPos = ref<{x: number; y: number} | null>(null);
function onPinHover(pin: MapPin | null): void {
    hoverPin.value = pin;
    emit('pinHover', pin);
    if (!pin) hoverPos.value = null;
}
function onCanvasMove(event: MouseEvent): void {
    if (!hoverPin.value) return;
    const host = (event.currentTarget as HTMLElement | null) ?? null;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    hoverPos.value = {
        x: event.clientX - rect.left + 14,
        y: event.clientY - rect.top + 14
    };
}
function clearHover(): void {
    hoverPin.value = null;
    hoverPos.value = null;
}
function tooltipStatusLabel(pin: MapPin): string {
    return STATUS_LABEL[(pin.status ?? 'unknown') as StatusKey];
}

const unmappedPreview = computed(() => props.unmappedLocations.slice(0, 4));
const hasUnmappedLocations = computed(() => props.unmappedLocations.length > 0);
const emptyTitle = computed(() =>
    hasUnmappedLocations.value
        ? 'Locations need coordinates.'
        : 'No locations have coordinates yet.'
);
const emptyMessage = computed(() =>
    hasUnmappedLocations.value
        ? `${props.unmappedLocations.length} location${props.unmappedLocations.length === 1 ? '' : 's'} have address details but no lat/lng. Add coordinates in location details to place them on the map.`
        : "Add lat/lng in a location's details to see it on the map."
);

const allPinBounds = computed(() => pinBounds(props.pins));

const initialViewport = computed<MapViewport>(() => {
    if (props.pins.length === 0) return DEFAULT_VIEWPORT;
    if (props.pins.length === 1) {
        return {
            longitude: props.pins[0].lng,
            latitude: props.pins[0].lat,
            zoom: MAP_SINGLE_PIN_ZOOM
        };
    }
    const b = allPinBounds.value as [[number, number], [number, number]];
    return {
        longitude: (b[0][0] + b[1][0]) / 2,
        latitude: (b[0][1] + b[1][1]) / 2,
        zoom: MAP_OVERVIEW_ZOOM
    };
});

const mapRef = computed(() => canvasRef.value?.map ?? null);
const loadedRef = computed(() => canvasRef.value?.loaded ?? false);

// Signal heatmap — fetched on-demand when the toggle is enabled.
const heatmapOn = ref(false);
const heatmapLoading = ref(false);
const heatmapPoints = ref<HeatmapPoint[]>([]);

// Density mode swaps individual pins for hex bins — helpful for
// world-zoomed views with hundreds of overlapping markers.
const densityMode = ref(false);
function toggleDensity() {
    densityMode.value = !densityMode.value;
}

const toast = useToastStore();


async function toggleHeatmap() {
    if (heatmapOn.value) {
        heatmapOn.value = false;
        heatmapPoints.value = [];
        return;
    }
    heatmapLoading.value = true;
    try {
        const res = await ws.sendRPC<{points: HeatmapPoint[]}>(
            'FLEET_MANAGER',
            'location.signalheatmap',
            {}
        );
        heatmapPoints.value = res?.points ?? [];
        heatmapOn.value = true;
    } catch (err) {
        toastRpcError(toast, err, 'Heatmap unavailable');
    } finally {
        heatmapLoading.value = false;
    }
}

// Viewport snapshot — recomputed on every map move so clustering can react.
interface MapViewportSnapshot {
    bbox: [number, number, number, number];
    zoom: number;
}
const viewport = ref<MapViewportSnapshot | null>(null);

function readViewport(): void {
    const map = mapRef.value;
    if (!map) return;
    const b = map.getBounds();
    viewport.value = {
        bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
        zoom: map.getZoom()
    };
}

// Hide legend/controls when fully zoomed out (operator needs minimal chrome).
const SHOW_CHROME_MIN_ZOOM = 2.2;
const showZoomChrome = computed(
    () => (viewport.value?.zoom ?? MAP_OVERVIEW_ZOOM) >= SHOW_CHROME_MIN_ZOOM
);

let detachMoveListener: (() => void) | null = null;

watch(loadedRef, (loaded) => {
    if (!loaded) return;
    readViewport();
    const map = mapRef.value;
    if (!map) return;
    map.on('moveend', readViewport);
    detachMoveListener = () => map.off('moveend', readViewport);
});

onBeforeUnmount(() => detachMoveListener?.());

const clusteringEnabled = computed(
    () => filteredPins.value.length >= props.clusterFrom
);

const partitioned = computed(() => {
    if (!clusteringEnabled.value || !viewport.value) {
        return {clusters: [] as readonly ClusterPoint[], loose: filteredPins.value};
    }
    return clusterPins(filteredPins.value, viewport.value);
});

// Cluster click jumps to city/neighborhood level so individual pins resolve.
const CLUSTER_EXPAND_MIN_ZOOM = 11;
function expandCluster(cluster: ClusterPoint): void {
    const map = mapRef.value;
    if (!map) return;
    const target = Math.max(
        map.getZoom() + 2,
        CLUSTER_EXPAND_MIN_ZOOM
    );
    map.flyTo({
        center: [cluster.lng, cluster.lat],
        zoom: Math.min(target, MAP_FIT_MAX_ZOOM),
        duration: 800,
        curve: 1.42,
        essential: false
    });
}

const {time} = useRafTime();
const pinAnimation = computed(() => ({timeMs: time.value}));

const layers = computed(() => {
    const out: ReturnType<typeof locationPinLayers> = [];
    if (densityMode.value && filteredPins.value.length > 0) {
        out.push(
            new HexagonLayer({
                id: 'fm-pins-density',
                data: filteredPins.value,
                getPosition: (p) => [p.lng, p.lat],
                radius: 50_000,
                coverage: 0.85,
                elevationScale: 0,
                pickable: false,
                extruded: false,
                opacity: 0.7,
                colorRange: viridisColorRange()
            }) as unknown as ReturnType<typeof locationPinLayers>[number]
        );
    } else {
        const {clusters, loose} = partitioned.value;
        if (clusters.length > 0) {
            out.push(
                ...clusterPinLayers(clusters, expandCluster) as ReturnType<
                    typeof locationPinLayers
                >
            );
        }
        out.push(
            ...locationPinLayers(
                loose,
                {onClick: onPinClick, onHover: onPinHover},
                pinAnimation.value,
                {selectedId: selectedPinId.value}
            )
        );
    }
    if (heatmapOn.value && heatmapPoints.value.length > 0) {
        return [heatmapLayer('fm-signal-heatmap', heatmapPoints.value), ...out];
    }
    return out;
});

useDeckOverlay(mapRef, layers);

let lastFittedSignature = '';

// First fit jumps (no camera intro); subsequent fits animate.
let hasFittedOnce = false;

function fitToPins() {
    const map = mapRef.value;
    const bounds = allPinBounds.value;
    if (!map || !bounds) return;
    map.fitBounds(bounds, {
        padding: MAP_FIT_PADDING_PX,
        duration: hasFittedOnce ? MAP_FLY_DURATION_MS : 0,
        maxZoom: MAP_FIT_MAX_ZOOM
    });
    hasFittedOnce = true;
}

// Signature dedupe avoids re-flying on identical-payload reactivity churn.
watch(
    [loadedRef, () => props.pins],
    ([loaded]) => {
        if (!loaded) return;
        const sig = pinPositionSignature(props.pins);
        if (sig === lastFittedSignature) return;
        lastFittedSignature = sig;
        fitToPins();
    },
    {flush: 'post'}
);

// Caller-supplied subset (e.g. search matches) — frames them with a tighter
// max zoom so a single match doesn't punch through to street level.
const SUBSET_FIT_MAX_ZOOM = 14;
function fitToPinSubset(pins: readonly MapPin[]): void {
    const map = mapRef.value;
    if (!map) return;
    if (pins.length === 1) {
        flyToPin(pins[0].lng, pins[0].lat);
        return;
    }
    const bounds = pinBounds(pins);
    if (!bounds) return;
    map.fitBounds(bounds, {
        padding: MAP_FIT_PADDING_PX,
        duration: MAP_FLY_DURATION_MS,
        maxZoom: SUBSET_FIT_MAX_ZOOM
    });
}

// essential:false → reduced-motion users get an instant jumpTo automatically.
const PIN_FLY_CONTEXT_ZOOM = 15;
const PIN_FLY_DURATION_MS = 1200;
function flyToPin(lng: number, lat: number): void {
    const map = mapRef.value;
    if (!map) return;
    map.flyTo({
        center: [lng, lat],
        zoom: Math.max(map.getZoom(), PIN_FLY_CONTEXT_ZOOM),
        duration: PIN_FLY_DURATION_MS,
        curve: 1.42,
        essential: false
    });
}

function onPinClick(pin: MapPin): void {
    selectedPinId.value = pin.id;
    emit('pinClick', pin);
    flyToPin(pin.lng, pin.lat);
}

// Parent pages overlay focus cards anchored to map pins. project() converts
// lng/lat to viewport pixels; onMapMove() relays pan/zoom/rotate AND the
// initial 'load' event so the parent gets one reprojection once the camera
// transform is finalised.
//
// Pre-load guard: project() returns null until map.loaded() — the camera
// matrix can produce NaN before the first paint and the parent's null check
// keeps the card anchored to its last known position.
defineExpose({
    project(lngLat: [number, number]): {x: number; y: number} | null {
        const m = mapRef.value;
        if (!m) return null;
        const p = m.project(lngLat);
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
        return {x: p.x, y: p.y};
    },
    onMapMove(cb: () => void): () => void {
        const m = mapRef.value;
        if (!m) return () => {};
        m.on('move', cb);
        m.on('load', cb);
        return () => {
            m.off('move', cb);
            m.off('load', cb);
        };
    },
    flyTo(lng: number, lat: number): void {
        flyToPin(lng, lat);
    },
    fitToPins(subset: readonly MapPin[]): void {
        fitToPinSubset(subset);
    }
});
</script>

<style scoped>
.wm {
    height: 100%;
    width: 100%;
}
.wm-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    background: color-mix(in srgb, var(--color-surface-1) 70%, transparent);
    color: var(--color-text-tertiary);
    text-align: center;
    z-index: 3;
}
.wm-empty i {
    font-size: var(--type-heading);
    color: var(--color-text-quaternary);
}
.wm-empty p {
    margin: 0;
    font-size: var(--type-body);
}
.wm-empty-sub {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    max-width: 420px;
}
.wm-empty-list {
    display: grid;
    gap: var(--space-1);
    max-width: 420px;
    margin: var(--space-1) 0 0;
    padding: 0;
    list-style: none;
}
.wm-empty-list li {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-1);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.wm-empty-list small {
    color: var(--color-text-quaternary);
}

/* iOS 26 Liquid Glass — detached from edges, capsule rounded, soft shadow.
   Material recipe: backdrop blur + saturate + low-opacity bg + 1px white-rim
   border + inset highlight + 3-layer drop shadow. */

.wm-controls {
    position: absolute;
    top: var(--space-4);
    left: var(--space-4);
    display: flex;
    gap: 2px;
    z-index: 2;
    padding: 4px;
    border-radius: 999px;
    background: rgba(28, 30, 34, 0.62);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 2px 6px rgba(0, 0, 0, 0.32),
        0 12px 32px rgba(0, 0, 0, 0.28);
}
.wm-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1-5) var(--space-3);
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}
.wm-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text-primary);
}
.wm-btn--active {
    background: rgba(255, 255, 255, 0.14);
    color: var(--color-text-primary);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
}
.wm-btn:disabled {
    opacity: 0.5;
    cursor: wait;
}

.wm-legend {
    position: absolute;
    right: var(--space-4);
    bottom: var(--space-4);
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 4px;
    border-radius: 999px;
    background: rgba(28, 30, 34, 0.62);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 2px 6px rgba(0, 0, 0, 0.32),
        0 12px 32px rgba(0, 0, 0, 0.28);
    z-index: 2;
}
.wm-legend__chip {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.82);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}
.wm-legend__chip:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--color-text-primary);
}
.wm-legend__chip--off {
    opacity: 0.35;
}
.wm-legend__label {
    line-height: 1;
}
.wm-legend__count {
    color: rgba(235, 235, 245, 0.6);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-medium);
}
.wm-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.4),
        0 0 0 1.5px rgba(255, 255, 255, 0.15);
}
.wm-dot--on { background: var(--color-status-on); }
.wm-dot--off { background: var(--color-status-off); }
.wm-dot--warn { background: var(--color-status-warn); }
.wm-dot--unknown { background: var(--color-status-unknown); }

.wm-tooltip {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    padding: var(--space-2) var(--space-3);
    border-radius: 14px;
    background: rgba(28, 30, 34, 0.78);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.08),
        0 2px 6px rgba(0, 0, 0, 0.35),
        0 12px 32px rgba(0, 0, 0, 0.3);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    line-height: 1.3;
    z-index: 4;
    max-width: 240px;
}
.wm-tooltip__name {
    font-weight: var(--font-semibold);
    margin-bottom: var(--space-0-5);
}
.wm-tooltip__meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    color: var(--color-text-tertiary);
}
.wm-tooltip__alert {
    color: var(--color-status-warn);
}

@media (max-width: 640px) {
    .wm-legend { display: none; }
}
</style>
