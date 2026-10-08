<template>
    <section
        ref="rootRef"
        class="lfp"
        :class="{'lfp--fullscreen': isFullscreen, 'lfp--editing': editMode}"
    >
        <FloorPlanTopBar
            :title="location.name"
            :subtitle="topbarSubtitle"
            :can-edit="canEdit && hasCanvas"
            :edit-mode="editMode"
            :is-dirty="isDirty"
            :saving="saving"
            :can-fullscreen="hasCanvas"
            :is-fullscreen="isFullscreen"
            @enter-edit="enterEdit"
            @cancel-edit="cancelEdit"
            @save-edit="saveEdit"
            @toggle-fullscreen="toggleFullscreen"
        >
            <template #extra>
                <div
                    v-if="hasCanvas"
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
                    v-if="hasCanvas && viewMode === '2d'"
                    class="lfp__canvas"
                    :plan="plan"
                    :zones="localZones"
                    :walls="localWalls"
                    :placements="effectivePlacements"
                    :devices="paletteDevices"
                    :edit-mode="editMode"
                    :drawing="draft"
                    :layer-visibility="layerVisibility"
                    @device-move="onDeviceMove"
                    @device-click="onCanvasDeviceClick"
                    @draft-vertex="onDraftVertex"
                />
                <FloorPlanCanvas3D
                    v-else-if="hasCanvas"
                    ref="canvas3dRef"
                    class="lfp__canvas"
                    :plan="plan"
                    :zones="localZones"
                    :walls="localWalls"
                    :placements="effectivePlacements"
                    :devices="paletteDevices"
                    :layer-visibility="layerVisibility"
                    :edit-mode="editMode"
                    :drawing="draft"
                    @device-click="onCanvasDeviceClick"
                    @device-move="onDeviceMove"
                    @draft-vertex="onDraftVertex"
                />
                <div v-else class="lfp__empty">
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

                <div v-if="hasCanvas && navSections.length > 0" class="lfp__nav">
                    <FloorNavDropdown
                        :sections="navSections"
                        :active-id="activeNavId"
                        :active-kind="activeNavKind"
                        :trigger-label="navTriggerLabel"
                        trigger-icon="fa-compass"
                        @select="onNavSelect"
                    />
                </div>

                <div v-if="hasCanvas && layerChips.length > 0" class="lfp__chips">
                    <FloorPlanLayerChips
                        :chips="layerChips"
                        @toggle="toggleLayer"
                    />
                </div>

                <p v-if="draft" class="lfp__draw-hint" role="status">
                    <i class="fas fa-crosshairs" aria-hidden="true" />
                    {{ drawHint }}
                </p>
                <p
                    v-else-if="hasCanvas && devices.length === 0"
                    class="lfp__no-devices"
                >
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

                <template #import>
                    <FloorPlanImportPanel
                        :can-import="canImport"
                        :state="planReadState"
                        :error="planReadError"
                        :candidates="importCandidates"
                        :devices="importTargets"
                        :existing="localPlacements"
                        :geometry="planGeometry"
                        :geometry-reading="planGeometryState === 'reading'"
                        :confirmed-zone-keys="importedZoneKeys"
                        :zone-error="zoneImportError"
                        :busy="saving"
                        @confirm="onImportConfirm"
                        @confirm-zones="onZoneImportConfirm"
                    />
                </template>

                <template #zones>
                    <template v-if="draft?.tool !== 'zone'">
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
                            Works the same in 2D and 3D.
                        </p>
                    </template>
                    <template v-else>
                        <p class="lfp-drw__hint">
                            Click on the plan to add corners
                            ({{ draft.points.length }} placed, need ≥3).
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
                                :disabled="!canUndoDraw"
                                @click="undoDraw"
                            >
                                Undo
                            </Button>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                @click="cancelDraft"
                            >Cancel</Button>
                        </div>
                    </template>
                </template>

                <template #walls>
                    <template v-if="draft?.tool !== 'wall'">
                        <Button
                            type="green"
                            size="sm"
                            :disabled="saving"
                            @click="beginWallDraft"
                        >
                            Draw walls
                        </Button>
                        <p class="lfp-drw__hint">
                            {{ wallCountLabel }} Trace along a wall to place
                            corners — over an uploaded drawing, or on a blank
                            floor when there is no drawing to upload.
                        </p>
                        <div v-if="localWalls.length > 0" class="lfp-drw__btn-row">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="saving"
                                @click="removeAllWalls"
                            >
                                Remove all walls
                            </Button>
                        </div>
                    </template>
                    <template v-else>
                        <p class="lfp-drw__hint">
                            Click along the wall to place corners
                            ({{ draft.points.length }} placed, need ≥2).
                            Finish keeps it and starts the next wall.
                        </p>
                        <div class="lfp-drw__btn-row">
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="!canFinishWall"
                                @click="finishWallRun"
                            >
                                Finish wall
                            </Button>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                :disabled="!canUndoDraw"
                                @click="undoDraw"
                            >
                                Undo
                            </Button>
                            <Button
                                type="blue-hollow"
                                size="sm"
                                @click="cancelDraft"
                            >Done</Button>
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
import FloorPlanImportPanel from '@/components/locations/floorplan/FloorPlanImportPanel.vue';
import FloorPlanLayerChips, {
    type LayerChip
} from '@/components/locations/floorplan/FloorPlanLayerChips.vue';
import FloorPlanTopBar from '@/components/locations/floorplan/FloorPlanTopBar.vue';
import {useSvgPlanImport} from '@/composables/useSvgPlanImport';
import {
    computeAutoPlacements,
    mergePlacements
} from '@/helpers/auto-placement';
import {FIXTURES_BY_CATEGORY} from '@/helpers/fixture-registry';
import {floorPlanPlacementId} from '@/helpers/floor-plan-device-identity';
import {hasGeometryChanged} from '@/helpers/floor-plan-dirty';
import {
    addVertex,
    beginDraft,
    canUndo,
    type DrawDraft,
    type DrawTool,
    draftToWallSegments,
    draftToZone,
    hasEnoughVertices,
    newShapeId,
    undoVertex
} from '@/helpers/floor-plan-draw';
import {buildPlacement} from '@/helpers/floor-plan-placement';
import {appendWalls, undoLastWall} from '@/helpers/floor-plan-walls';
import {
    applyZoneConfirmations,
    DuplicateZoneNameError,
    type ZoneConfirmation
} from '@/helpers/floor-plan-zone-import';
import {rpcErrorMessage} from '@/helpers/rpcError';
import {
    applyImportSelections,
    buildImportCandidates,
    type ImportTargetDevice
} from '@/helpers/svg-device-import';
import {useLocationsStore} from '@/stores/locations';
import type {
    DevicePlacementMap,
    FixtureCategory,
    FixtureKind,
    FloorPlanKindFields,
    PlanPoint,
    WallSegment,
    ZoneShape
} from '@/types/floor-plan';

// Three.js chunk is heavy (~600 KB) — lazy-load only on 3D toggle.
const FloorPlanCanvas3D = defineAsyncComponent(
    () => import('@/components/core/FloorPlanCanvas3D.vue')
);

const props = withDefaults(
    defineProps<{
        location: ApiLocation;
        devices: FloorPlanDevice[];
        canEdit: boolean;
        /** Mirrors the backend location.Update gate. Without it the whole
         *  import surface is absent — the user still sees the plan. */
        canImport?: boolean;
        /** Same gate, for the drawing tools. Denied means the zone and wall
         *  tools are absent, never a control that fails on save. */
        canDraw?: boolean;
    }>(),
    {canImport: false, canDraw: false}
);

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

// The canvas is available whenever there is a plan to show OR a user
// allowed to draw one. D-032: hand-drawing is a normal way to set up a
// floor, so "no drawing uploaded" must not mean "no floor to work on".
const hasCanvas = computed(() => !!plan.value || props.canDraw);

const storedZones = computed<ZoneShape[]>(
    () => kindFieldsBlob.value.zones ?? []
);
const storedWalls = computed<WallSegment[]>(
    () => kindFieldsBlob.value.walls ?? []
);
const storedPlacements = computed<DevicePlacementMap>(
    () => kindFieldsBlob.value.devicePlacements ?? {}
);

const localPlacements = ref<DevicePlacementMap>({...storedPlacements.value});
const localZones = ref<ZoneShape[]>(storedZones.value.map((z) => ({...z})));
const localWalls = ref<WallSegment[]>(cloneWalls(storedWalls.value));

function cloneWalls(walls: readonly WallSegment[]): WallSegment[] {
    return walls.map((w) => ({from: {...w.from}, to: {...w.to}}));
}

const autoPlacements = computed(() =>
    computeAutoPlacements(props.devices.map(floorPlanPlacementId))
);
const effectivePlacements = computed<DevicePlacementMap>(() =>
    mergePlacements(autoPlacements.value, localPlacements.value)
);

watch(storedPlacements, (next) => {
    if (!editMode.value) localPlacements.value = {...next};
});
// Guarded on editMode like placements are: geometry now persists on Save,
// so an update arriving from another session mid-edit must not overwrite
// work the user has not committed yet. cancelEdit and saveEdit both
// re-read from the store, so nothing stays stale after the edit ends.
watch(storedZones, (next) => {
    if (editMode.value || draft.value) return;
    localZones.value = next.map((z) => ({...z}));
});
watch(storedWalls, (next) => {
    if (editMode.value || draft.value) return;
    localWalls.value = cloneWalls(next);
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
    if (wallsDirty.value) return true;
    if ((draft.value?.points.length ?? 0) > 0) return true;
    return false;
});

// Order-insensitive on purpose — see floor-plan-dirty.ts. kindFields is
// JSONB, so a saved floor comes back with its keys rearranged and a naive
// comparison would leave it looking permanently unsaved.
const zonesDirty = computed(() =>
    hasGeometryChanged(localZones.value, storedZones.value)
);

const wallsDirty = computed(() =>
    hasGeometryChanged(localWalls.value, storedWalls.value)
);

// ── Drawing ────────────────────────────────────────────────────────────
// One draft, one vertex handler, one undo — shared by the zone and wall
// tools and by both canvases. The 2D and 3D canvases each resolve a click
// to a normalized point their own way and then emit the same event, so
// there is a single draw pipeline behind them (D-032).

const draft = ref<DrawDraft | null>(null);
const draftZoneName = ref('');
const draftZoneColor = ref('#5b8def');

const canFinishZone = computed(
    () =>
        draft.value?.tool === 'zone' &&
        hasEnoughVertices(draft.value) &&
        draftZoneName.value.trim().length > 0
);

const canFinishWall = computed(
    () => draft.value?.tool === 'wall' && hasEnoughVertices(draft.value)
);

// Undo steps back through the draft first, then through walls already
// committed this session — so the button always removes the last thing the
// user did rather than going dead the moment a run is finished.
const canUndoDraw = computed(
    () =>
        canUndo(draft.value) ||
        (draft.value?.tool === 'wall' && localWalls.value.length > 0)
);

const DRAW_HINTS: Record<DrawTool, string> = {
    zone: 'Click to add a zone corner. Finish in the Zones panel.',
    wall: 'Click to trace a wall. Finish in the Walls panel.'
};

const drawHint = computed(() =>
    draft.value ? DRAW_HINTS[draft.value.tool] : ''
);

const wallCountLabel = computed(() => {
    const n = localWalls.value.length;
    if (n === 0) return 'No walls drawn yet.';
    return `${n} wall segment${n === 1 ? '' : 's'} drawn.`;
});

// No view-mode switch: drawing works wherever the user already is. The 3D
// canvas raycasts the click onto the floor plane and emits the same
// normalized point the 2D canvas does.
function beginZoneDraft(): void {
    draft.value = beginDraft('zone');
    draftZoneName.value = '';
}

function beginWallDraft(): void {
    draft.value = beginDraft('wall');
}

function onDraftVertex(point: PlanPoint): void {
    const current = draft.value;
    if (!current) return;
    draft.value = addVertex(current, point);
}

function undoDraw(): void {
    const current = draft.value;
    if (!current) return;
    if (canUndo(current)) {
        draft.value = undoVertex(current);
        return;
    }
    if (current.tool === 'wall') localWalls.value = undoLastWall(localWalls.value);
}

function cancelDraft(): void {
    draft.value = null;
    draftZoneName.value = '';
}

function finishZone(): void {
    const current = draft.value;
    if (!current) return;
    const zone = draftToZone(current, {
        id: newShapeId('zone'),
        name: draftZoneName.value,
        color: draftZoneColor.value
    });
    if (!zone) return;
    localZones.value = [...localZones.value, zone];
    cancelDraft();
}

// Keeps the run and immediately opens the next one: a floor is many walls,
// and re-arming the tool by hand after each is the wrong default.
function finishWallRun(): void {
    const current = draft.value;
    if (!current) return;
    const segments = draftToWallSegments(current);
    if (segments.length === 0) return;
    localWalls.value = appendWalls(localWalls.value, segments);
    draft.value = beginDraft('wall');
}

function removeZone(id: string): void {
    localZones.value = localZones.value.filter((z) => z.id !== id);
}

function removeAllWalls(): void {
    localWalls.value = [];
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

// ── Import what the SVG plan already draws ─────────────────────────────
// Device markers and room geometry come out of one read of one file.
// Reading is gated on canImport, so a user who could not save the result
// never puts the plan on the wire for it either.

const planUrl = computed(() => plan.value?.url ?? null);
const canImportRef = computed(() => props.canImport);
const {
    markers,
    state: planReadState,
    error: planReadError,
    geometry: planGeometry,
    geometryState: planGeometryState,
    readGeometry
} = useSvgPlanImport(planUrl, canImportRef);

// Resolving geometry costs about a second of main thread on a real CAD
// export, so it waits until the user opens the panel that shows it.
watch([openEditSection, planReadState], ([section, readState]) => {
    if (section === 'import' && readState === 'ready') readGeometry();
});

const importTargets = computed<ImportTargetDevice[]>(() =>
    props.devices.map((d) => ({
        placementId: floorPlanPlacementId(d),
        label: d.label,
        componentTypes: d.componentTypes
    }))
);

const importCandidates = computed(() =>
    buildImportCandidates({
        markers: markers.value,
        devices: importTargets.value,
        existing: localPlacements.value
    })
);

const markerCount = computed(() => importCandidates.value.length);

// Confirmed mappings land in the local draft, not on the server: the user
// still reviews the pins and presses Save, so there is exactly one path
// that persists placements.
function onImportConfirm(selections: Record<string, string>): void {
    const outcome = applyImportSelections({
        existing: localPlacements.value,
        candidates: importCandidates.value,
        selections
    });
    localPlacements.value = outcome.placements;
    openEditSection.value = 'placements';
}

// ── Import rooms detected in the drawing ───────────────────────────────
// Candidate regions are evidence. They become zones here and only here,
// once a user has named them and pressed the button — then they follow the
// hand-drawn zones down the same Save.

const importedZoneKeys = ref<string[]>([]);
const zoneImportError = ref<string | null>(null);

function onZoneImportConfirm(confirmations: ZoneConfirmation[]): void {
    try {
        const outcome = applyZoneConfirmations({
            existing: localZones.value,
            candidates: planGeometry.value?.zoneCandidates ?? [],
            confirmations
        });
        localZones.value = [...outcome.zones];
        importedZoneKeys.value = [
            ...importedZoneKeys.value,
            ...confirmations.map((c) => c.key)
        ];
        zoneImportError.value = null;
        // Land the user on the zones they just made, the way a confirmed
        // marker lands them on the pin it placed.
        if (props.canDraw) openEditSection.value = 'zones';
    } catch (cause: unknown) {
        // A refusal must look like a refusal: nothing was added, and the
        // reason stays on screen until the user resolves it.
        zoneImportError.value = describeZoneImportFailure(cause);
    }
}

function describeZoneImportFailure(cause: unknown): string {
    if (cause instanceof DuplicateZoneNameError) {
        return `${cause.message}. Rename it and confirm again.`;
    }
    return rpcErrorMessage(cause);
}

function forgetZoneImport(): void {
    importedZoneKeys.value = [];
    zoneImportError.value = null;
}

// A replaced drawing proposes a different set of regions, so what was
// already taken from the old one no longer means anything.
watch(planGeometry, forgetZoneImport);

const canvasHostRef = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const canvas3dRef = ref<{
    normalizedPointAt(
        clientX: number,
        clientY: number
    ): {x: number; y: number} | null;
} | null>(null);
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
    const point = dropPointFor(e);
    if (!point) return;
    onDeviceMove(id, point);
}

// 2D maps the drop straight onto the plan image, so screen-rect fractions
// are the normalized coords. Under the 3D perspective camera they are not
// — the scene has to project the cursor onto the floor plane instead.
function dropPointFor(e: DragEvent): {x: number; y: number} | null {
    if (viewMode.value === '3d') {
        return canvas3dRef.value?.normalizedPointAt(e.clientX, e.clientY)
            ?? null;
    }
    const rect = (
        e.currentTarget as HTMLElement | null
    )?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height
    };
}

function placeAtCenter(id: string) {
    if (!editMode.value || localPlacements.value[id]) return;
    onDeviceMove(id, {x: 0.5, y: 0.5});
}

function onDeviceMove(id: string, position: {x: number; y: number}): void {
    placeDevice({id, x: position.x, y: position.y});
}

function placeDevice(input: {id: string; x: number; y: number}): void {
    const next = buildPlacement({
        existing: localPlacements.value[input.id],
        point: {x: input.x, y: input.y}
    });
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
    editMode.value = true;
    // Open on the drawing when it has something to say — markers waiting to
    // be mapped, or a file we could not read.
    const drawingNeedsAttention =
        props.canImport &&
        (planReadState.value === 'error' || markerCount.value > 0);
    openEditSection.value = drawingNeedsAttention ? 'import' : 'placements';
}

function cancelEdit(): void {
    localPlacements.value = {...storedPlacements.value};
    localZones.value = storedZones.value.map((z) => ({...z}));
    localWalls.value = cloneWalls(storedWalls.value);
    // The imported zones went with the reverted list, so the regions they
    // came from are on offer again.
    forgetZoneImport();
    cancelDraft();
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

// One persistence path for every kind of geometry. A refused save leaves
// edit mode open with the work intact — the store has already surfaced the
// error as a toast, so nothing here may make it look saved.
async function saveEdit(): Promise<void> {
    if (!isDirty.value) {
        editMode.value = false;
        return;
    }
    const landed = await pushKindFieldsToBackend({
        devicePlacements: localPlacements.value,
        zones: localZones.value,
        walls: localWalls.value
    });
    if (!landed) return;
    cancelDraft();
    editMode.value = false;
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

// 2D carries the walls toggle too now that walls are drawn and rendered
// there. Without it, hiding walls in 3D and switching to 2D left zones and
// walls invisible with no chip to bring them back.
const TOGGLES_2D: ReadonlyArray<{key: LayerKey; label: string; icon: string}> = [
    {key: 'floor', label: 'Plan', icon: 'fa-image'},
    {key: 'walls', label: 'Walls', icon: 'fa-grip-lines-vertical'},
    {key: 'devices', label: 'Devices', icon: 'fa-plug'}
];
const TOGGLES_3D: ReadonlyArray<{key: LayerKey; label: string; icon: string}> = [
    {key: 'floor', label: 'Floor', icon: 'fa-image'},
    {key: 'walls', label: 'Walls', icon: 'fa-grip-lines-vertical'},
    {key: 'devices', label: 'Devices', icon: 'fa-plug'}
];

const layerChips = computed<LayerChip[]>(() => {
    const source = viewMode.value === '3d' ? TOGGLES_3D : TOGGLES_2D;
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
    // Absent entirely without location.Update — not merely disabled.
    ...(props.canImport
        ? [
              {
                  key: 'import',
                  label: 'From drawing',
                  icon: 'fa-file-import',
                  badge:
                      planReadState.value === 'ready' ? markerCount.value : null
              }
          ]
        : []),
    // Same rule for the drawing tools: no scoped location.Update means no
    // tool at all, never a control that fails once the user has done work.
    ...(props.canDraw
        ? [
              {
                  key: 'zones',
                  label: 'Zones',
                  icon: 'fa-draw-polygon',
                  badge: localZones.value.length
              },
              {
                  key: 'walls',
                  label: 'Walls',
                  icon: 'fa-grip-lines-vertical',
                  badge: localWalls.value.length
              }
          ]
        : []),
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
    const parts = [tier, `${placed}/${total} placed`];
    // Surfaces the import outside edit mode — otherwise the markers are only
    // discoverable by opening the drawer.
    if (props.canImport && markerCount.value > 0) {
        parts.push(`${markerCount.value} in drawing`);
    }
    return parts.join(' · ');
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

const UNSAVED_PROMPT =
    'You have unsaved floor plan changes. Leave anyway and discard them?';

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
        localWalls.value = cloneWalls(storedWalls.value);
        forgetZoneImport();
        cancelDraft();
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

/* Same pill as the no-devices hint, but it is telling the user what their
   next click does — so it reads primary, not incidental. */
.lfp__draw-hint {
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
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-full);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
}

.lfp__draw-hint i {
    color: var(--color-primary);
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
