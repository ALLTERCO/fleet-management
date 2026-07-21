<template>
    <section
        ref="rootRef"
        class="lfp"
        :class="{'lfp--fullscreen': isFullscreen, 'lfp--editing': editMode}"
    >
        <FloorPlanTopBar
            :title="location.name"
            :subtitle="topbarSubtitle"
            :can-edit="canEdit && !!plan"
            :edit-mode="editMode"
            :is-dirty="isDirty"
            :saving="saving"
            :can-fullscreen="!!plan"
            :is-fullscreen="isFullscreen"
            @enter-edit="enterEdit"
            @cancel-edit="cancelEdit"
            @save-edit="saveEdit"
            @toggle-fullscreen="toggleFullscreen"
        >
            <template #extra>
                <div
                    v-if="plan && !editMode"
                    class="lfp-view-pill"
                    role="group"
                    aria-label="View mode"
                >
                    <button
                        type="button"
                        class="lfp-view-pill__btn"
                        :class="{'lfp-view-pill__btn--on': viewMode === '2d'}"
                        @click="viewMode = '2d'"
                    >2D</button>
                    <button
                        type="button"
                        class="lfp-view-pill__btn"
                        :class="{'lfp-view-pill__btn--on': viewMode === '3d'}"
                        @click="viewMode = '3d'"
                    >3D</button>
                </div>
            </template>
        </FloorPlanTopBar>

        <div class="lfp__body">
            <div
                ref="canvasHostRef"
                class="lfp__stage"
                @dragover.prevent="onPaletteDragOver"
                @drop.prevent="onPaletteDrop"
            >
                <FloorPlanCanvas
                    v-if="plan && (viewMode === '2d' || editMode)"
                    class="lfp__canvas"
                    :plan="plan"
                    :zones="localZones"
                    :placements="effectivePlacements"
                    :devices="paletteDevices"
                    :edit-mode="editMode"
                    :drawing-zone="drawingZone"
                    :layer-visibility="layerVisibility"
                    @device-move="onDeviceMove"
                    @device-click="onCanvasDeviceClick"
                    @zone-vertex="onZoneVertex"
                />
                <FloorPlanCanvas3D
                    v-else-if="plan"
                    class="lfp__canvas"
                    :plan="plan"
                    :zones="localZones"
                    :placements="effectivePlacements"
                    :devices="paletteDevices"
                    :layer-visibility="layerVisibility"
                    :edit-mode="false"
                    @device-click="onCanvasDeviceClick"
                    @device-move="onDeviceMove"
                />
                <div v-else-if="!plan" class="lfp__empty">
                    <div class="lfp__empty-icon">
                        <i class="fas fa-map" aria-hidden="true" />
                    </div>
                    <h4 class="lfp__empty-title">No floor plan yet</h4>
                    <p class="lfp__empty-sub">
                        Upload a PNG, JPG, WebP or layered SVG to map rooms
                        and place devices on the plan.
                    </p>
                    <Button
                        v-if="canEdit"
                        type="blue"
                        size="sm"
                        @click="$emit('requestUpload')"
                    >
                        Upload floor plan
                    </Button>
                </div>

                <div v-if="plan && navSections.length > 0" class="lfp__nav">
                    <FloorNavDropdown
                        :sections="navSections"
                        :active-id="activeNavId"
                        :active-kind="activeNavKind"
                        :trigger-label="navTriggerLabel"
                        trigger-icon="fa-compass"
                        @select="onNavSelect"
                    />
                </div>

                <div v-if="plan && layerChips.length > 0" class="lfp__chips">
                    <FloorPlanLayerChips
                        :chips="layerChips"
                        @toggle="toggleLayer"
                    />
                </div>

                <p v-if="plan && devices.length === 0" class="lfp__no-devices">
                    <i class="fas fa-plug" aria-hidden="true" />
                    No devices assigned to this location yet.
                </p>
            </div>

            <FloorPlanEditDrawer
                v-if="editMode"
                v-model:open-section="openEditSection"
                :sections="drawerSections"
                @close="requestExitEdit"
            >
                <template #placements>
                    <p v-if="unplacedDevices.length === 0 && placedDevices.length === 0" class="lfp-drw__hint">
                        No devices assigned to this location yet.
                    </p>
                    <template v-else>
                        <p v-if="unplacedDevices.length > 0" class="lfp-drw__sub">
                            Drag onto the plan, or click to drop in the centre.
                        </p>
                        <ul v-if="unplacedDevices.length > 0" class="lfp-drw__list">
                            <li
                                v-for="d in unplacedDevices"
                                :key="d.id"
                                class="lfp-drw__chip"
                                :title="`Drag onto the plan to place ${d.label}`"
                                draggable="true"
                                @dragstart="onPaletteDragStart($event, floorPlanPlacementId(d))"
                                @click="placeAtCenter(floorPlanPlacementId(d))"
                            >
                                <span
                                    class="lfp-drw__dot"
                                    :style="{background: paletteDotStyle(d.color)}"
                                />
                                <span class="lfp-drw__label">{{ d.label }}</span>
                                <i class="fas fa-arrow-right lfp-drw__chev" aria-hidden="true" />
                            </li>
                        </ul>

                        <p v-if="placedDevices.length > 0" class="lfp-drw__sub">
                            Placed ({{ placedDevices.length }})
                        </p>
                        <ul v-if="placedDevices.length > 0" class="lfp-drw__list">
                            <li
                                v-for="d in placedDevices"
                                :key="d.id"
                                class="lfp-drw__row"
                            >
                                <span
                                    class="lfp-drw__dot"
                                    :style="{background: paletteDotStyle(d.color)}"
                                />
                                <span class="lfp-drw__label">{{ d.label }}</span>
                                <button
                                    type="button"
                                    class="lfp-drw__icon-btn"
                                    title="Remove from plan"
                                    @click="removePlacement(floorPlanPlacementId(d))"
                                >
                                    <i class="fas fa-xmark" aria-hidden="true" />
                                </button>
                            </li>
                        </ul>
                    </template>
                </template>

                <template #zones>
                    <template v-if="!drawingZone">
                        <Button
                            type="green"
                            size="sm"
                            :disabled="saving"
                            @click="beginZoneDraft"
                        >
                            Draw new zone
                        </Button>
                        <ul v-if="localZones.length > 0" class="lfp-drw__list lfp-drw__list--tight">
                            <li
                                v-for="z in localZones"
                                :key="z.id"
                                class="lfp-drw__row"
                            >
                                <span class="lfp-drw__dot" :style="{background: z.color}" />
                                <span class="lfp-drw__label">{{ z.name }}</span>
                                <button
                                    type="button"
                                    class="lfp-drw__icon-btn"
                                    :title="`Remove ${z.name}`"
                                    :disabled="saving"
                                    @click="removeZone(z.id)"
                                >
                                    <i class="fas fa-xmark" aria-hidden="true" />
                                </button>
                            </li>
                        </ul>
                        <p v-else class="lfp-drw__hint">
                            Use Draw new zone to outline a room or area.
                        </p>
                    </template>
                    <template v-else>
                        <p class="lfp-drw__hint">
                            Click on the plan to add vertices
                            ({{ drawingZone.points.length }} placed, need ≥3).
                        </p>
                        <Input
                            v-model="draftZoneName"
                            class="lfp-drw__input"
                            placeholder="Zone name"
                        />
                        <div class="lfp-drw__color-row">
                            <label class="lfp-drw__color-label">Colour</label>
                            <input
                                v-model="draftZoneColor"
                                type="color"
                                class="lfp-drw__color"
                                :title="`Zone colour: ${draftZoneColor}`"
                            />
                        </div>
                        <div class="lfp-drw__btn-row">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="!canFinishZone"
                                @click="finishZone"
                            >
                                Finish
                            </Button>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="!drawingZone.points.length"
                                @click="undoZoneVertex"
                            >
                                Undo
                            </Button>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                @click="cancelZoneDraft"
                            >Cancel</Button>
                        </div>
                    </template>
                </template>

                <template #fixtures>
                    <p v-if="placedDevices.length === 0" class="lfp-drw__hint">
                        Place a device on the plan to choose its fixture.
                    </p>
                    <ul v-else class="lfp-drw__list lfp-drw__list--tight">
                        <li
                            v-for="d in placedDevices"
                            :key="d.id"
                            class="lfp-drw__fixture"
                        >
                            <span class="lfp-drw__dot" :style="{background: paletteDotStyle(d.color)}" />
                            <span class="lfp-drw__label" :title="d.label">{{ d.label }}</span>
                            <select
                                class="lfp-drw__select"
                                :value="localPlacements[floorPlanPlacementId(d)]?.fixture ?? ''"
                                :title="`Set fixture for ${d.label}`"
                                @change="setPlacementFixture(floorPlanPlacementId(d), ($event.target as HTMLSelectElement).value)"
                            >
                                <option value="">— Generic pin —</option>
                                <optgroup
                                    v-for="(group, cat) in fixturesByCategory"
                                    :key="cat"
                                    :label="categoryLabel(cat)"
                                >
                                    <option
                                        v-for="f in group"
                                        :key="f.kind"
                                        :value="f.kind"
                                    >{{ f.label }}</option>
                                </optgroup>
                            </select>
                        </li>
                    </ul>
                </template>
            </FloorPlanEditDrawer>
        </div>
    </section>
</template>

<script setup lang="ts">
import type {Location as ApiLocation} from '@api/location';
import {
    computed,
    defineAsyncComponent,
    onBeforeUnmount,
    onMounted,
    ref,
    watch
} from 'vue';
import {onBeforeRouteLeave, onBeforeRouteUpdate} from 'vue-router';
import Button from '@/components/core/Button.vue';
import FloorPlanCanvas, {
    type FloorPlanDevice
} from '@/components/core/FloorPlanCanvas.vue';
import Input from '@/components/core/Input.vue';
import FloorNavDropdown, {
    type FloorNavItem,
    type FloorNavKind,
    type FloorNavSection
} from '@/components/locations/floorplan/FloorNavDropdown.vue';
import FloorPlanEditDrawer, {
    type EditDrawerSection
} from '@/components/locations/floorplan/FloorPlanEditDrawer.vue';
import FloorPlanLayerChips, {
    type LayerChip
} from '@/components/locations/floorplan/FloorPlanLayerChips.vue';
import FloorPlanTopBar from '@/components/locations/floorplan/FloorPlanTopBar.vue';
import {
    computeAutoPlacements,
    mergePlacements
} from '@/helpers/auto-placement';
import {FIXTURES_BY_CATEGORY} from '@/helpers/fixture-registry';
import {floorPlanPlacementId} from '@/helpers/floor-plan-device-identity';
import {useLocationsStore} from '@/stores/locations';
import type {
    DevicePlacement,
    DevicePlacementMap,
    FixtureCategory,
    FixtureKind,
    FloorPlanKindFields,
    ZoneShape
} from '@/types/floor-plan';

// Three.js chunk is heavy (~600 KB) — lazy-load only on 3D toggle.
const FloorPlanCanvas3D = defineAsyncComponent(
    () => import('@/components/core/FloorPlanCanvas3D.vue')
);

const props = defineProps<{
    location: ApiLocation;
    devices: FloorPlanDevice[];
    canEdit: boolean;
}>();

const emit = defineEmits<{
    deviceClick: [id: string];
    requestUpload: [];
}>();

const store = useLocationsStore();
const editMode = ref(false);
const saving = ref(false);
const viewMode = ref<'2d' | '3d'>('2d');
const isFullscreen = ref(false);
const openEditSection = ref<string>('placements');

type LayerKey = 'floor' | 'walls' | 'devices';
const layerVisibility = ref<Record<LayerKey, boolean>>({
    floor: true,
    walls: true,
    devices: true
});

// Token bumped per save AND on location nav. A stale finally that resolves
// after a newer save / nav started checks the token and bails.
let saveSeq = 0;

const liveLocation = computed<ApiLocation | null>(
    () => store.locations[props.location.id] ?? props.location
);

const kindFieldsBlob = computed<FloorPlanKindFields>(
    () => (liveLocation.value?.kindFields ?? {}) as FloorPlanKindFields
);

const plan = computed(() => {
    const p = kindFieldsBlob.value.floorPlan;
    if (!p?.url || !p.widthPx || !p.heightPx) return null;
    return p;
});

const storedZones = computed<ZoneShape[]>(
    () => kindFieldsBlob.value.zones ?? []
);
const storedPlacements = computed<DevicePlacementMap>(
    () => kindFieldsBlob.value.devicePlacements ?? {}
);

const localPlacements = ref<DevicePlacementMap>({...storedPlacements.value});
const localZones = ref<ZoneShape[]>(storedZones.value.map((z) => ({...z})));

const autoPlacements = computed(() =>
    computeAutoPlacements(props.devices.map(floorPlanPlacementId))
);
const effectivePlacements = computed<DevicePlacementMap>(() =>
    mergePlacements(autoPlacements.value, localPlacements.value)
);

watch(storedPlacements, (next) => {
    if (!editMode.value) localPlacements.value = {...next};
});
watch(storedZones, (next) => {
    if (drawingZone.value) return;
    localZones.value = next.map((z) => ({...z}));
});

const isDirty = computed(() => {
    const a = localPlacements.value;
    const b = storedPlacements.value;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        const x = a[k];
        const y = b[k];
        if (!x || !y) return true;
        if (x.x !== y.x || x.y !== y.y || (x.rot ?? 0) !== (y.rot ?? 0)) {
            return true;
        }
        if ((x.fixture ?? '') !== (y.fixture ?? '')) return true;
    }
    if (zonesDirty.value) return true;
    if ((drawingZone.value?.points.length ?? 0) > 0) return true;
    return false;
});

const zonesDirty = computed(() => {
    const a = localZones.value;
    const b = storedZones.value;
    if (a.length !== b.length) return true;
    return JSON.stringify(a) !== JSON.stringify(b);
});

// ── Zone drawing state ─────────────────────────────────────────────────
interface ZoneDraftLocal {
    points: Array<{x: number; y: number}>;
    color: string;
}
const drawingZone = ref<ZoneDraftLocal | null>(null);
const draftZoneName = ref('');
const draftZoneColor = ref('#5b8def');

const canFinishZone = computed(
    () =>
        !!drawingZone.value &&
        drawingZone.value.points.length >= 3 &&
        draftZoneName.value.trim().length > 0
);

function beginZoneDraft() {
    drawingZone.value = {points: [], color: draftZoneColor.value};
    draftZoneName.value = '';
}

function onZoneVertex(x: number, y: number) {
    drawingZone.value?.points.push({x: clamp01(x), y: clamp01(y)});
}

function undoZoneVertex() {
    drawingZone.value?.points.pop();
}

function cancelZoneDraft() {
    drawingZone.value = null;
    draftZoneName.value = '';
    localZones.value = storedZones.value.map((z) => ({...z}));
}

async function finishZone() {
    const d = drawingZone.value;
    if (!d || d.points.length < 3) return;
    const name = draftZoneName.value.trim();
    if (!name) return;
    const zone: ZoneShape = {
        id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        color: draftZoneColor.value,
        points: d.points.map((p) => ({x: clamp01(p.x), y: clamp01(p.y)}))
    };
    localZones.value = [...localZones.value, zone];
    drawingZone.value = null;
    draftZoneName.value = '';
    await persistZones();
}

function removeZone(id: string) {
    localZones.value = localZones.value.filter((z) => z.id !== id);
    void persistZones();
}

async function persistZones(): Promise<void> {
    const previousZones = storedZones.value.map((z) => ({...z}));
    const landed = await pushKindFieldsToBackend({zones: localZones.value});
    if (!landed) localZones.value = previousZones;
}

function buildMergedKindFields(
    patch: Partial<FloorPlanKindFields>
): Record<string, unknown> {
    return {...kindFieldsBlob.value, ...patch} as Record<string, unknown>;
}

// Sends the merged blob; answers whether THIS save's result landed.
// Stale writes (a newer save started or the user navigated) answer true
// so the caller doesn't roll back data the new context already owns.
async function pushKindFieldsToBackend(
    patch: Partial<FloorPlanKindFields>
): Promise<boolean> {
    const token = ++saveSeq;
    saving.value = true;
    try {
        const result = await store.updateLocation(props.location.id, {
            kindFields: buildMergedKindFields(patch)
        });
        if (token !== saveSeq) return true;
        return result !== null;
    } finally {
        if (token === saveSeq) saving.value = false;
    }
}
// ───────────────────────────────────────────────────────────────────────

const paletteDevices = computed(() => props.devices);

const unplacedDevices = computed(() =>
    props.devices.filter((d) => !localPlacements.value[floorPlanPlacementId(d)])
);

const placedDevices = computed(() =>
    props.devices.filter((d) => !!localPlacements.value[floorPlanPlacementId(d)])
);

const fixturesByCategory = FIXTURES_BY_CATEGORY;

const CATEGORY_LABELS: Record<FixtureCategory, string> = {
    lighting: 'Lighting',
    hvac: 'HVAC',
    appliance: 'Appliances',
    solar: 'Solar / energy',
    smart: 'Smart fixtures',
    control: 'Wall controls',
    entertainment: 'Entertainment',
    access: 'Smart access',
    furniture: 'Furniture'
};

function categoryLabel(cat: FixtureCategory): string {
    return CATEGORY_LABELS[cat];
}

function setPlacementFixture(id: string, value: string): void {
    const current = localPlacements.value[id];
    if (!current) return;
    const fixture = value === '' ? undefined : (value as FixtureKind);
    localPlacements.value = {
        ...localPlacements.value,
        [id]: {...current, fixture}
    };
}

function removePlacement(id: string): void {
    const next = {...localPlacements.value};
    delete next[id];
    localPlacements.value = next;
}

const canvasHostRef = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const PALETTE_DRAG_MIME = 'application/x-fm-device-id';

function onPaletteDragStart(e: DragEvent, id: string) {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData(PALETTE_DRAG_MIME, id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
}

function onPaletteDragOver(e: DragEvent) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

function onPaletteDrop(e: DragEvent) {
    if (!editMode.value || !plan.value) return;
    const id =
        e.dataTransfer?.getData(PALETTE_DRAG_MIME) ||
        e.dataTransfer?.getData('text/plain') ||
        '';
    if (!id) return;
    if (localPlacements.value[id]) return;
    const rect = (
        e.currentTarget as HTMLElement | null
    )?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    onDeviceMove(id, {x, y});
}

function placeAtCenter(id: string) {
    if (!editMode.value || localPlacements.value[id]) return;
    onDeviceMove(id, {x: 0.5, y: 0.5});
}

function onDeviceMove(id: string, position: {x: number; y: number}): void {
    placeDevice({id, x: position.x, y: position.y});
}

function placeDevice(input: {id: string; x: number; y: number}): void {
    const existing = localPlacements.value[input.id];
    const next: DevicePlacement = {
        x: clamp01(input.x),
        y: clamp01(input.y),
        rot: existing?.rot ?? 0,
        fixture: existing?.fixture
    };
    localPlacements.value = {...localPlacements.value, [input.id]: next};
}

function onCanvasDeviceClick(id: string): void {
    emit('deviceClick', id);
}

function paletteDotStyle(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
}

// ── Top-bar action handlers ────────────────────────────────────────────

function enterEdit(): void {
    if (viewMode.value === '3d') viewMode.value = '2d';
    editMode.value = true;
    openEditSection.value = 'placements';
}

function cancelEdit(): void {
    localPlacements.value = {...storedPlacements.value};
    localZones.value = storedZones.value.map((z) => ({...z}));
    drawingZone.value = null;
    draftZoneName.value = '';
    editMode.value = false;
}

// Drawer X uses this to avoid discarding work without a heads-up.
// The top-bar Cancel button calls cancelEdit() directly — that's the
// user's explicit "throw it out" lever.
function requestExitEdit(): void {
    if (!isDirty.value) {
        editMode.value = false;
        return;
    }
    if (window.confirm(UNSAVED_PROMPT)) cancelEdit();
}

async function saveEdit(): Promise<void> {
    if (!isDirty.value) {
        editMode.value = false;
        return;
    }
    const landed = await pushKindFieldsToBackend({
        devicePlacements: localPlacements.value,
        zones: localZones.value
    });
    if (landed) editMode.value = false;
}

async function toggleFullscreen(): Promise<void> {
    const root = rootRef.value;
    if (!root) return;
    if (!document.fullscreenElement) {
        await root.requestFullscreen?.();
        isFullscreen.value = true;
    } else {
        await document.exitFullscreen?.();
        isFullscreen.value = false;
    }
}

function onFullscreenChange(): void {
    isFullscreen.value = !!document.fullscreenElement;
}

// ── Layer chips overlay ────────────────────────────────────────────────

const TOGGLES_2D: ReadonlyArray<{key: LayerKey; label: string; icon: string}> = [
    {key: 'floor', label: 'Plan', icon: 'fa-image'},
    {key: 'devices', label: 'Devices', icon: 'fa-plug'}
];
const TOGGLES_3D: ReadonlyArray<{key: LayerKey; label: string; icon: string}> = [
    {key: 'floor', label: 'Floor', icon: 'fa-image'},
    {key: 'walls', label: 'Walls', icon: 'fa-grip-lines-vertical'},
    {key: 'devices', label: 'Devices', icon: 'fa-plug'}
];

const layerChips = computed<LayerChip[]>(() => {
    const source = viewMode.value === '3d' && !editMode.value
        ? TOGGLES_3D
        : TOGGLES_2D;
    return source.map((t) => ({
        key: t.key,
        label: t.label,
        icon: t.icon,
        active: layerVisibility.value[t.key]
    }));
});

function toggleLayer(key: string): void {
    const k = key as LayerKey;
    layerVisibility.value[k] = !layerVisibility.value[k];
}

// ── Edit drawer sections ───────────────────────────────────────────────

const drawerSections = computed<EditDrawerSection[]>(() => [
    {
        key: 'placements',
        label: 'Placements',
        icon: 'fa-thumbtack',
        badge: placedDevices.value.length
    },
    {
        key: 'zones',
        label: 'Zones',
        icon: 'fa-draw-polygon',
        badge: localZones.value.length
    },
    {
        key: 'fixtures',
        label: 'Fixtures',
        icon: 'fa-lightbulb',
        badge: null
    }
]);

const topbarSubtitle = computed(() => {
    const tier = store.kindLabel(props.location.kind);
    if (!plan.value) return tier;
    const placed = placedDevices.value.length;
    const total = props.devices.length;
    return `${tier} · ${placed}/${total} placed`;
});

// ── On-this-floor navigator (Verkada/Meraki pattern) ──────────────────
// Top-left floating dropdown that lists zones drawn on the plan and the
// devices placed on it. Picking one focuses the corresponding feature on
// the canvas (zone → emits zone click via canvas vertex routing, device →
// re-emits as the existing device-click event the host already handles).

const activeNavId = ref<number | string | null>(null);
const activeNavKind = ref<FloorNavKind | null>(null);

const zoneNavItems = computed<FloorNavItem[]>(() =>
    localZones.value.map((zone) => ({
        id: zone.id,
        kind: 'zone' as const,
        label: zone.name,
        colorDot: zone.color
    }))
);

const deviceNavItems = computed<FloorNavItem[]>(() =>
    placedDevices.value.map((device) => ({
        id: device.id,
        kind: 'device' as const,
        label: device.label,
        colorDot: `#${device.color.toString(16).padStart(6, '0')}`
    }))
);

const navSections = computed<FloorNavSection[]>(() => {
    const sections: FloorNavSection[] = [];
    if (zoneNavItems.value.length > 0) {
        sections.push({
            title: 'Zones',
            icon: 'fa-draw-polygon',
            items: zoneNavItems.value
        });
    }
    if (deviceNavItems.value.length > 0) {
        sections.push({
            title: 'Devices on this floor',
            icon: 'fa-plug',
            items: deviceNavItems.value
        });
    }
    return sections;
});

const navTriggerLabel = computed(() => {
    if (activeNavKind.value === 'zone' && activeNavId.value !== null) {
        const zone = localZones.value.find((z) => z.id === activeNavId.value);
        if (zone) return `Zone · ${zone.name}`;
    }
    if (activeNavKind.value === 'device' && activeNavId.value !== null) {
        const device = placedDevices.value.find(
            (d) => d.id === activeNavId.value
        );
        if (device) return `Device · ${device.label}`;
    }
    const counts: string[] = [];
    if (zoneNavItems.value.length > 0) {
        counts.push(
            `${zoneNavItems.value.length} zone${zoneNavItems.value.length === 1 ? '' : 's'}`
        );
    }
    if (deviceNavItems.value.length > 0) {
        counts.push(
            `${deviceNavItems.value.length} device${deviceNavItems.value.length === 1 ? '' : 's'}`
        );
    }
    return counts.length > 0 ? counts.join(' · ') : 'On this floor';
});

function onNavSelect(item: FloorNavItem): void {
    activeNavId.value = item.id;
    activeNavKind.value = item.kind;
    if (item.kind === 'device' && typeof item.id === 'string') {
        emit('deviceClick', item.id);
    }
}

function clamp01(v: number): number {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

const UNSAVED_PROMPT =
    'You have unsaved device placement changes. Leave anyway and discard them?';

function beforeUnloadHandler(e: BeforeUnloadEvent) {
    if (!isDirty.value) return;
    e.preventDefault();
    e.returnValue = UNSAVED_PROMPT;
}

onMounted(() => {
    window.addEventListener('beforeunload', beforeUnloadHandler);
    document.addEventListener('fullscreenchange', onFullscreenChange);
});

onBeforeUnmount(() => {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
});

function unsavedGuard(): boolean {
    if (saving.value) return true;
    if (!isDirty.value) return true;
    return window.confirm(UNSAVED_PROMPT);
}

onBeforeRouteLeave(unsavedGuard);
onBeforeRouteUpdate((to, from) => {
    const toParams = to.params as Record<string, string | string[] | undefined>;
    const fromParams = from.params as Record<
        string,
        string | string[] | undefined
    >;
    if (String(toParams.id ?? '') === String(fromParams.id ?? '')) return true;
    return unsavedGuard();
});

watch(
    () => props.location.id,
    () => {
        saveSeq++;
        editMode.value = false;
        saving.value = false;
        localPlacements.value = {...storedPlacements.value};
        localZones.value = storedZones.value.map((z) => ({...z}));
        drawingZone.value = null;
        draftZoneName.value = '';
    }
);
</script>

<style scoped>
.lfp {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 480px;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.lfp--fullscreen {
    border-radius: 0;
    border: none;
    min-height: 100vh;
}

.lfp__body {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
}

.lfp__stage {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    background: var(--color-surface-bg);
}

.lfp__canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.lfp__nav {
    position: absolute;
    top: var(--space-4);
    left: var(--space-4);
    z-index: 3;
    pointer-events: auto;
}

.lfp__chips {
    position: absolute;
    bottom: var(--space-4);
    left: var(--space-4);
    z-index: 2;
    pointer-events: auto;
}

.lfp__no-devices {
    position: absolute;
    bottom: var(--space-3);
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    pointer-events: none;
    margin: 0;
    padding: var(--space-1-5) var(--space-3);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}

.lfp__no-devices i {
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.lfp__empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    text-align: center;
    padding: var(--space-8);
}

.lfp__empty-icon {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
    margin-bottom: var(--space-2);
}

.lfp__empty-title {
    margin: 0;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
}

.lfp__empty-sub {
    margin: 0;
    font-size: var(--type-caption);
    max-width: 40ch;
}

.lfp-view-pill {
    display: inline-flex;
    padding: var(--space-0-5);
    background: var(--glass-3-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
}

.lfp-view-pill__btn {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    padding: var(--space-1) var(--space-2-5);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--duration-fast), color var(--duration-fast);
}

.lfp-view-pill__btn:hover {
    color: var(--color-text-primary);
}

.lfp-view-pill__btn--on {
    background: var(--color-primary);
    color: var(--color-text-primary);
}

/* ── Drawer panels ────────────────────────────────────────────────── */

.lfp-drw__hint {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.lfp-drw__sub {
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.lfp-drw__sub:first-child {
    margin-top: 0;
}

.lfp-drw__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.lfp-drw__list--tight {
    gap: var(--space-0-5);
}

.lfp-drw__chip,
.lfp-drw__row,
.lfp-drw__fixture {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    cursor: grab;
    user-select: none;
}

.lfp-drw__row,
.lfp-drw__fixture {
    cursor: default;
}

.lfp-drw__chip:hover {
    background: var(--color-surface-3);
    border-color: var(--color-border-strong);
}

.lfp-drw__dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.lfp-drw__label {
    flex: 1;
    font-size: var(--type-caption);
    color: var(--color-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.lfp-drw__chev {
    color: var(--color-text-quaternary);
    font-size: var(--type-caption);
}

.lfp-drw__icon-btn {
    appearance: none;
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
    padding: var(--space-0-5) var(--space-1-5);
    border-radius: var(--radius-sm);
}

.lfp-drw__icon-btn:hover {
    background: var(--state-hover-bg);
    color: var(--color-status-warn);
}

.lfp-drw__select {
    width: 100%;
    margin-top: var(--space-1);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
}

.lfp-drw__fixture {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: var(--space-2);
}

.lfp-drw__fixture .lfp-drw__select {
    grid-column: 1 / -1;
}

.lfp-drw__input {
    margin-top: var(--space-2);
}

.lfp-drw__color-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-2);
}

.lfp-drw__color-label {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.lfp-drw__color {
    appearance: none;
    width: 32px;
    height: 24px;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
    background: transparent;
    padding: 0;
}

.lfp-drw__btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-3);
}
</style>
