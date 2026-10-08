<template>
    <div class="fpc">
        <div ref="hostRef" class="fpc-host" />
        <div v-if="unsupported" class="fpc-empty">
            <i class="fas fa-triangle-exclamation" />
            <p>Floor plan unavailable</p>
            <p class="fpc-empty-sub">
                WebGL is disabled in this browser. Enable hardware
                acceleration to see the floor plan.
            </p>
        </div>
        <div v-else-if="!plan && isBlankFloor" class="fpc-empty">
            <i class="fas fa-image" />
            <p>No floor plan uploaded</p>
            <p class="fpc-empty-sub">
                Upload a PNG, SVG or JPG — or draw the walls and rooms by
                hand on the blank sheet.
            </p>
        </div>
        <div v-else-if="planLoadError" class="fpc-empty">
            <i class="fas fa-triangle-exclamation" />
            <p>Floor plan failed to load</p>
            <p class="fpc-empty-sub">
                The plan image could not be loaded. Re-upload the file or try
                again.
            </p>
        </div>
        <div v-if="editMode && !unsupported" class="fpc-edit-badge">
            <i class="fas fa-pen" /> Edit mode — drag devices to place
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, toRef} from 'vue';
import {useFloorPlanStage} from '@/composables/useFloorPlanStage';
import type {DrawDraft} from '@/helpers/floor-plan-draw';
import type {
    DevicePlacementMap,
    FloorPlanRef,
    PlanPoint,
    WallSegment,
    ZoneShape
} from '@/types/floor-plan';

export interface FloorPlanDevice {
    /** Current external ID used for device interaction. */
    id: string;
    /** Permanent device.list.id used as the placement JSON key. */
    placementId?: string;
    label: string;
    color: number;
    /** Device reachability. False = grey, no emissive. */
    online?: boolean;
    /** Output intensity 0..1 — drives emissive on lamps/dimmers/strips.
     *  Binary devices set 0 or 1; analog devices (TRV target, dimmer
     *  brightness) set the fraction. */
    level?: number;
    /** Component types the device reports (`switch`, `light`, `cover`).
     *  Read by the SVG import to match a drawing's category layer against
     *  what the device actually is. Not used for rendering. */
    componentTypes?: readonly string[];
}

const props = withDefaults(
    defineProps<{
        plan: FloorPlanRef | null;
        zones?: ZoneShape[];
        walls?: WallSegment[];
        placements?: DevicePlacementMap;
        devices?: FloorPlanDevice[];
        editMode?: boolean;
        /** The zone or wall being drawn. Non-null turns clicks into
         *  vertices — same contract the 3D canvas honours. */
        drawing?: DrawDraft | null;
        layerVisibility?: {floor: boolean; walls: boolean; devices: boolean};
    }>(),
    {
        zones: () => [],
        walls: () => [],
        placements: () => ({}),
        devices: () => [],
        editMode: false,
        drawing: null,
        layerVisibility: () => ({floor: true, walls: true, devices: true})
    }
);

const emit = defineEmits<{
    'device-move': [id: string, position: {x: number; y: number}];
    'device-click': [id: string];
    'draft-vertex': [point: PlanPoint];
}>();

const hostRef = ref<HTMLElement | null>(null);

// The upload prompt is for an empty floor only. Once anything has been
// drawn it would be telling the user to fix something already done.
const isBlankFloor = computed(
    () => props.zones.length === 0 && props.walls.length === 0
);

const planRef = computed(() => props.plan);
const zonesRef = toRef(props, 'zones');
const wallsRef = toRef(props, 'walls');
const placementsRef = toRef(props, 'placements');
const devicesRef = toRef(props, 'devices');
const editRef = toRef(props, 'editMode');
const drawingRef = toRef(props, 'drawing');
const layerVisibilityRef = toRef(props, 'layerVisibility');

const {unsupported, planLoadError} = useFloorPlanStage(hostRef, {
    plan: planRef,
    zones: zonesRef,
    walls: wallsRef,
    placements: placementsRef,
    devices: devicesRef,
    editMode: editRef,
    drawing: drawingRef,
    layerVisibility: layerVisibilityRef,
    onDeviceMove: (id: string, position: {x: number; y: number}) =>
        emit('device-move', id, position),
    onDeviceClick: (id) => emit('device-click', id),
    onDraftVertex: (point) => emit('draft-vertex', point)
});
</script>

<style scoped>
.fpc {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 360px;
    border-radius: var(--radius-lg);
    background:
        repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.025) 0,
            rgba(255, 255, 255, 0.025) 1px,
            transparent 1px,
            transparent 24px
        ),
        repeating-linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.025) 0,
            rgba(255, 255, 255, 0.025) 1px,
            transparent 1px,
            transparent 24px
        ),
        var(--color-surface-1);
    overflow: hidden;
}
.fpc-host {
    position: absolute;
    inset: 0;
}
/* Pixi-appended canvas is styled inline by useFloorPlanStage — no rule here
   would have matched it anyway (it's added at runtime, outside Vue's
   scoped-style tagging). */
.fpc-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    text-align: center;
    color: var(--color-text-tertiary);
    z-index: 2;
    pointer-events: none;
}
.fpc-empty i {
    font-size: var(--type-heading);
    color: var(--color-text-quaternary);
}
.fpc-empty p {
    margin: 0;
}
.fpc-empty-sub {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    max-width: 300px;
}
.fpc-edit-badge {
    position: absolute;
    top: var(--space-3);
    left: var(--space-3);
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--color-primary) 25%, var(--color-surface-2));
    border: 1px solid var(--color-primary);
    color: var(--color-primary-text);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    z-index: 2;
    pointer-events: none;
}
</style>
