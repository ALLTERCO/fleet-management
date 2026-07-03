<template>
    <div
        ref="hostRef"
        class="fpc3d"
        role="img"
        aria-label="3D floor plan — drag to orbit, scroll to zoom"
    >
        <div v-if="!webglUnsupported && showInlineControls" class="fpc3d__presets" role="group" aria-label="Camera preset">
            <button
                type="button"
                class="fpc3d__preset"
                :class="{'fpc3d__preset--active': activeView === 'top'}"
                title="Top-down view"
                @click="setView('top')"
            >
                <i class="fas fa-table-cells" />
            </button>
            <button
                type="button"
                class="fpc3d__preset"
                :class="{'fpc3d__preset--active': activeView === 'iso'}"
                title="Isometric view"
                @click="setView('iso')"
            >
                <i class="fas fa-cube" />
            </button>
            <button
                type="button"
                class="fpc3d__preset"
                :class="{'fpc3d__preset--active': activeView === 'free'}"
                title="Free orbit"
                @click="setView('free')"
            >
                <i class="fas fa-arrows-rotate" />
            </button>
        </div>
        <div v-if="!webglUnsupported && showInlineControls" class="fpc3d__lighting" role="group" aria-label="Lighting mode">
            <button
                type="button"
                class="fpc3d__preset"
                :class="{'fpc3d__preset--active': activeLighting === 'day'}"
                title="Day lighting"
                @click="setLighting('day')"
            >
                <i class="fas fa-sun" />
            </button>
            <button
                type="button"
                class="fpc3d__preset"
                :class="{'fpc3d__preset--active': activeLighting === 'night'}"
                title="Night lighting"
                @click="setLighting('night')"
            >
                <i class="fas fa-moon" />
            </button>
            <button
                type="button"
                class="fpc3d__preset"
                :class="{'fpc3d__preset--active': activeLighting === 'alert'}"
                title="Alert lighting"
                @click="setLighting('alert')"
            >
                <i class="fas fa-triangle-exclamation" />
            </button>
        </div>
        <div v-if="webglUnsupported" class="fpc3d__fallback" role="alert">
            <i class="fas fa-cube-xmark" aria-hidden="true" />
            <p>3D view isn't supported by this browser.</p>
            <p class="fpc3d__fallback-sub">Switch back to 2D to view this floor plan.</p>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import type {FloorPlanDevice} from '@/components/core/FloorPlanCanvas.vue';
import {
    type CameraView,
    createFloorPlanScene,
    type FloorPlanScene,
    type LightingMode
} from '@/helpers/floor-plan-3d';
import {hasWebGL} from '@/helpers/webgl';
import type {
    DevicePlacementMap,
    FloorPlanRef,
    ZoneShape
} from '@/types/floor-plan';

const props = withDefaults(
    defineProps<{
        plan: FloorPlanRef | null;
        zones?: ZoneShape[];
        placements?: DevicePlacementMap;
        devices?: FloorPlanDevice[];
        layerVisibility?: {floor: boolean; walls: boolean; devices: boolean};
        editMode?: boolean;
        /** Render the inline view-preset and lighting-mode button groups.
         *  Off by default — the host wraps the canvas in its own chrome
         *  (top-bar + layer chips), so these float-on-canvas controls are
         *  visual noise. Set true only for stand-alone use. */
        showInlineControls?: boolean;
    }>(),
    {
        zones: () => [],
        placements: () => ({}),
        devices: () => [],
        layerVisibility: () => ({floor: true, walls: true, devices: true}),
        editMode: false,
        showInlineControls: false
    }
);

const emit = defineEmits<{
    'device-click': [id: string];
    'device-move': [id: string, position: {x: number; y: number}];
}>();

const hostRef = ref<HTMLElement | null>(null);
const webglUnsupported = ref(false);
const activeView = ref<CameraView>('free');
const activeLighting = ref<LightingMode>('day');
let scene: FloorPlanScene | null = null;

function setView(view: CameraView): void {
    activeView.value = view;
    scene?.setView(view);
}

function setLighting(mode: LightingMode): void {
    activeLighting.value = mode;
    scene?.setLighting(mode);
}

// Single computed input → single watcher. Four separate watchers fired
// sync() four times on any same-tick prop update; this collapses to one.
const sceneInput = computed(() => ({
    plan: props.plan,
    zones: props.zones,
    placements: props.placements,
    devices: props.devices
}));

function sync(): void {
    if (!scene) return;
    scene.update(sceneInput.value);
}

onMounted(() => {
    if (!hostRef.value) return;
    if (!hasWebGL()) {
        webglUnsupported.value = true;
        return;
    }
    try {
        scene = createFloorPlanScene();
        scene.onDeviceClick((id) => emit('device-click', id));
        scene.onDeviceMove((id, position) => emit('device-move', id, position));
        scene.setEditMode(props.editMode);
        // The layerVisibility watch fired during setup when `scene` was
        // null, so the toggles never landed on this fresh scene (matters
        // most on view-mode remounts where state was already non-default).
        applyLayerVisibility(props.layerVisibility);
        scene.mount(hostRef.value);
        sync();
    } catch (err) {
        console.warn('[FloorPlanCanvas3D] init failed', err);
        webglUnsupported.value = true;
        scene = null;
    }
});

watch(sceneInput, sync, {deep: true});
watch(
    () => props.editMode,
    (enabled) => scene?.setEditMode(enabled)
);
watch(
    () => props.layerVisibility,
    (v) => applyLayerVisibility(v),
    {deep: true}
);

function applyLayerVisibility(v: {
    floor: boolean;
    walls: boolean;
    devices: boolean;
}): void {
    if (!scene) return;
    scene.setLayerVisibility('floor', v.floor);
    scene.setLayerVisibility('walls', v.walls);
    scene.setLayerVisibility('devices', v.devices);
}

onBeforeUnmount(() => {
    scene?.dispose();
    scene = null;
});
</script>

<style scoped>
.fpc3d {
    width: 100%;
    height: 100%;
    min-height: var(--floor-plan-min-h, 320px);
    position: relative;
    background: var(--color-surface-bg);
    border-radius: var(--radius-lg);
    overflow: hidden;
    touch-action: none;
}
.fpc3d__presets,
.fpc3d__lighting {
    position: absolute;
    top: var(--space-2);
    display: flex;
    gap: var(--space-1);
    z-index: 1;
    background: var(--glass-4-bg);
    backdrop-filter: var(--glass-4-filter);
    -webkit-backdrop-filter: var(--glass-4-filter);
    box-shadow: inset 0 1px 0 var(--glass-highlight);
    padding: 2px;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-subtle);
}
.fpc3d__presets { right: var(--space-2); }
.fpc3d__lighting { right: 132px; }
.fpc3d__preset {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--color-text-tertiary);
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--type-body);
}
.fpc3d__preset:hover { color: var(--color-text-primary); background: var(--color-surface-4); }
.fpc3d__preset--active { color: var(--color-primary); background: var(--color-surface-4); }
.fpc3d__fallback {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    color: var(--color-text-tertiary);
    text-align: center;
    padding: var(--space-6);
}
.fpc3d__fallback i {
    font-size: var(--type-heading);
    color: var(--color-text-disabled);
    margin-bottom: var(--space-2);
}
.fpc3d__fallback p { margin: 0; font-size: var(--type-body); }
.fpc3d__fallback-sub {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
}
</style>
