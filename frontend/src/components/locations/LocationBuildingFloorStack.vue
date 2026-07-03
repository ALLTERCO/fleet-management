<template>
    <div class="lbfs">
        <div
            ref="hostRef"
            class="lbfs__canvas"
            role="img"
            aria-label="Floor stack — drag to orbit, scroll to zoom, click a floor to open"
        />

        <div v-if="hoverHint" class="lbfs__hover-pill" aria-hidden="true">
            {{ hoverHint }}
        </div>

        <div v-if="layout.entries.length === 0" class="lbfs__empty">
            <p class="lbfs__empty-title">No floors here yet</p>
            <p class="lbfs__empty-sub">
                Add child locations of kind "floor" to this building to see
                them stacked here.
            </p>
        </div>

        <div v-else class="lbfs__selector">
            <FloorNavDropdown
                :sections="navSections"
                :active-id="hoveredId"
                active-kind="floor"
                :trigger-label="triggerLabel"
                trigger-icon="fa-layer-group"
                @select="onSelectNav"
            />
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    AmbientLight,
    BoxGeometry,
    type Color,
    DirectionalLight,
    Mesh,
    MeshStandardMaterial,
    type Object3D,
    PerspectiveCamera,
    Raycaster,
    Scene,
    Vector2,
    WebGLRenderer
} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import FloorNavDropdown, {
    type FloorNavItem,
    type FloorNavSection
} from '@/components/locations/floorplan/FloorNavDropdown.vue';
import {
    FLOOR_STACK_CAMERA_DISTANCE_FACTOR_TENTHS,
    FLOOR_STACK_CAMERA_HEIGHT_FACTOR_TENTHS,
    FLOOR_STACK_GAP_Y,
    FLOOR_STACK_PLANE_SIZE,
    FLOOR_STACK_SLAB_OPACITY_PCT,
    FLOOR_STACK_SLAB_THICKNESS_TENTHS
} from '@/constants';
import {resolveBrandColor} from '@/helpers/brand-tokens';
import {
    computeFloorStackLayout,
    type FloorStackEntry,
    type FloorStackLayout,
    selectFloorsOfBuilding
} from '@/helpers/buildingFloorStack';
import {hasWebGL} from '@/helpers/webgl';
import type {ApiLocation} from '@/stores/locations';
import {useLocationsStore} from '@/stores/locations';

const STACK_OPTIONS = {
    gapY: FLOOR_STACK_GAP_Y,
    planeSize: FLOOR_STACK_PLANE_SIZE
} as const;
const SLAB_THICKNESS = FLOOR_STACK_SLAB_THICKNESS_TENTHS / 10;
const SLAB_OPACITY = FLOOR_STACK_SLAB_OPACITY_PCT / 100;
const CAMERA_DISTANCE_FACTOR = FLOOR_STACK_CAMERA_DISTANCE_FACTOR_TENTHS / 10;
const CAMERA_HEIGHT_FACTOR = FLOOR_STACK_CAMERA_HEIGHT_FACTOR_TENTHS / 10;
const CAMERA_FOV_DEG = 45;
const SCENE_NEAR = 0.1;
const SCENE_FAR = 1000;
const AMBIENT_LIGHT_INTENSITY = 0.6;
const DIRECTIONAL_LIGHT_INTENSITY = 0.9;
const DIRECTIONAL_LIGHT_POSITION = {x: 40, y: 80, z: 40} as const;
const ORBIT_DAMPING_FACTOR = 0.08;
const MATERIAL_ROUGHNESS = 0.5;
const MATERIAL_METALNESS = 0.1;
const BRAND_FALLBACK_HEX = '#4495d1';
// Hovered slab lifts this much, lerp-eased per frame.
const HOVER_LIFT_UNITS = 0.6;
const HOVER_LERP = 0.18;

const props = defineProps<{location: ApiLocation}>();

const emit = defineEmits<{
    open: [floorId: number];
}>();

const hostRef = ref<HTMLElement | null>(null);
const store = useLocationsStore();

// Hovered floor id — drives both the overlay highlight and the slab lift.
const hoveredId = ref<number | null>(null);

const floors = computed<readonly ApiLocation[]>(() =>
    selectFloorsOfBuilding({
        buildingId: props.location.id,
        locations: store.locations
    })
);

const layout = computed<FloorStackLayout>(() =>
    computeFloorStackLayout({floors: floors.value, options: STACK_OPTIONS})
);

const floorNavItems = computed<FloorNavItem[]>(() =>
    [...layout.value.entries].reverse().map((entry) => ({
        id: entry.id,
        kind: 'floor' as const,
        label: entry.name,
        icon: 'fa-layer-group',
        meta: shortLabel(entry)
    }))
);

const navSections = computed<FloorNavSection[]>(() => [
    {
        title: 'Floors',
        icon: 'fa-layer-group',
        items: floorNavItems.value,
        emptyHint: 'No floors in this building yet.'
    }
]);

const triggerLabel = computed(() => {
    const id = hoveredId.value;
    if (id == null) return `Floors · ${floorNavItems.value.length}`;
    const entry = layout.value.entries.find((e) => e.id === id);
    return entry?.name ?? 'Floor';
});

function onSelectNav(item: FloorNavItem): void {
    if (item.kind === 'floor' && typeof item.id === 'number') {
        emit('open', item.id);
    }
}

const hoverHint = computed(() => {
    const id = hoveredId.value;
    if (id == null) return null;
    const entry = layout.value.entries.find((e) => e.id === id);
    if (!entry) return null;
    return entry.name;
});

function shortLabel(entry: FloorStackEntry): string {
    const loc = store.locations[entry.id];
    const floorNumber = (loc?.kindFields as {floorNumber?: number} | undefined)
        ?.floorNumber;
    if (typeof floorNumber === 'number') {
        return floorNumber < 0 ? `B${Math.abs(floorNumber)}` : String(floorNumber);
    }
    return String(entry.order + 1);
}

interface SceneState {
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    controls: OrbitControls;
    raycaster: Raycaster;
    pointer: Vector2;
    floorMeshes: Mesh[];
    floorIdByMesh: Map<Object3D, number>;
    baseYByMesh: Map<Mesh, number>;
    rafId: number | null;
    resizeObserver: ResizeObserver | null;
    detachPointer: (() => void) | null;
}

let state: SceneState | null = null;

onMounted(() => {
    if (!hostRef.value || !hasWebGL()) return;
    state = tryCreateSceneState(hostRef.value);
    if (state) refreshScene();
});

onBeforeUnmount(() => {
    disposeScene();
});

watch(layout, refreshScene);

function tryCreateSceneState(host: HTMLElement): SceneState | null {
    try {
        return createSceneState(host);
    } catch (err) {
        console.warn('[LocationBuildingFloorStack] WebGL init failed:', err);
        return null;
    }
}

function refreshScene(): void {
    if (!state) return;
    syncFloorMeshes(state, layout.value);
    fitCamera(state, layout.value);
}

function createSceneState(host: HTMLElement): SceneState {
    const renderer = createRenderer(host);
    const scene = createSceneWithLights();
    const camera = createCamera(host);
    const controls = createOrbitControls(camera, renderer.domElement);
    const raycaster = new Raycaster();
    const pointer = new Vector2();

    const detachPointer = wirePointerHandler({
        host,
        raycaster,
        pointer,
        camera,
        getMeshes: () => state?.floorMeshes ?? [],
        onPick: emitFloorPick,
        onHover: setHoveredMesh
    });

    const resizeObserver = new ResizeObserver(() =>
        handleResize({renderer, camera, host})
    );
    resizeObserver.observe(host);

    const newState: SceneState = {
        renderer,
        scene,
        camera,
        controls,
        raycaster,
        pointer,
        floorMeshes: [],
        floorIdByMesh: new Map(),
        baseYByMesh: new Map(),
        rafId: null,
        resizeObserver,
        detachPointer
    };

    startRenderLoop(newState);
    return newState;
}

function createRenderer(host: HTMLElement): WebGLRenderer {
    const renderer = new WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    return renderer;
}

function createSceneWithLights(): Scene {
    const scene = new Scene();
    scene.background = null;
    scene.add(new AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY));
    const sun = new DirectionalLight(0xffffff, DIRECTIONAL_LIGHT_INTENSITY);
    sun.position.set(
        DIRECTIONAL_LIGHT_POSITION.x,
        DIRECTIONAL_LIGHT_POSITION.y,
        DIRECTIONAL_LIGHT_POSITION.z
    );
    scene.add(sun);
    return scene;
}

function createCamera(host: HTMLElement): PerspectiveCamera {
    return new PerspectiveCamera(
        CAMERA_FOV_DEG,
        host.clientWidth / host.clientHeight,
        SCENE_NEAR,
        SCENE_FAR
    );
}

function createOrbitControls(
    camera: PerspectiveCamera,
    domElement: HTMLElement
): OrbitControls {
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.dampingFactor = ORBIT_DAMPING_FACTOR;
    return controls;
}

function syncFloorMeshes(sceneState: SceneState, next: FloorStackLayout): void {
    clearExistingMeshes(sceneState);
    const brandTint = resolveBrandColor('--color-primary', BRAND_FALLBACK_HEX);
    for (const entry of next.entries) {
        addFloorMesh({sceneState, entry, brandTint});
    }
}

function clearExistingMeshes(sceneState: SceneState): void {
    for (const mesh of sceneState.floorMeshes) {
        sceneState.scene.remove(mesh);
        disposeMesh(mesh);
    }
    sceneState.floorMeshes = [];
    sceneState.floorIdByMesh.clear();
    sceneState.baseYByMesh.clear();
}

function addFloorMesh(input: {
    readonly sceneState: SceneState;
    readonly entry: FloorStackEntry;
    readonly brandTint: Color;
}): void {
    const {sceneState, entry, brandTint} = input;
    const mesh = createFloorMesh({entry, brandTint});
    sceneState.scene.add(mesh);
    sceneState.floorMeshes.push(mesh);
    sceneState.floorIdByMesh.set(mesh, entry.id);
    sceneState.baseYByMesh.set(mesh, entry.y);
}

function createFloorMesh(input: {
    readonly entry: FloorStackEntry;
    readonly brandTint: Color;
}): Mesh {
    const {entry, brandTint} = input;
    const geometry = new BoxGeometry(entry.size, SLAB_THICKNESS, entry.size);
    const material = new MeshStandardMaterial({
        color: brandTint,
        transparent: true,
        opacity: SLAB_OPACITY,
        roughness: MATERIAL_ROUGHNESS,
        metalness: MATERIAL_METALNESS
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.y = entry.y;
    return mesh;
}

function fitCamera(sceneState: SceneState, next: FloorStackLayout): void {
    const stackTop = next.totalHeightY;
    const distance = computeCameraDistance(stackTop);
    sceneState.camera.position.set(
        distance,
        stackTop * CAMERA_HEIGHT_FACTOR,
        distance
    );
    sceneState.controls.target.set(0, stackTop / 2, 0);
    sceneState.controls.update();
}

function computeCameraDistance(stackTop: number): number {
    const planeBound = STACK_OPTIONS.planeSize * CAMERA_DISTANCE_FACTOR;
    const stackBound = stackTop * CAMERA_HEIGHT_FACTOR;
    return Math.max(planeBound, stackBound);
}

function startRenderLoop(sceneState: SceneState): void {
    const tick = (): void => {
        applyHoverLift(sceneState);
        sceneState.controls.update();
        sceneState.renderer.render(sceneState.scene, sceneState.camera);
        sceneState.rafId = window.requestAnimationFrame(tick);
    };
    sceneState.rafId = window.requestAnimationFrame(tick);
}

// Each frame, ease each slab toward its target Y — baseY for non-hovered,
// baseY + HOVER_LIFT_UNITS for the hovered one. lerp factor stays per-frame
// constant so the rate is framerate-stable for typical 60Hz displays.
function applyHoverLift(sceneState: SceneState): void {
    const hovered = hoveredId.value;
    for (const mesh of sceneState.floorMeshes) {
        const baseY = sceneState.baseYByMesh.get(mesh) ?? mesh.position.y;
        const id = sceneState.floorIdByMesh.get(mesh);
        const targetY = id === hovered ? baseY + HOVER_LIFT_UNITS : baseY;
        mesh.position.y += (targetY - mesh.position.y) * HOVER_LERP;
    }
}

function disposeScene(): void {
    if (!state) return;
    stopRenderLoop(state);
    state.detachPointer?.();
    state.resizeObserver?.disconnect();
    for (const mesh of state.floorMeshes) disposeMesh(mesh);
    state.controls.dispose();
    state.renderer.dispose();
    state.renderer.domElement.remove();
    state = null;
}

function disposeMesh(mesh: Mesh): void {
    mesh.geometry.dispose();
    const material = mesh.material as MeshStandardMaterial;
    material.dispose();
}

interface PointerWireInput {
    readonly host: HTMLElement;
    readonly raycaster: Raycaster;
    readonly pointer: Vector2;
    readonly camera: PerspectiveCamera;
    readonly getMeshes: () => readonly Mesh[];
    readonly onPick: (mesh: Mesh) => void;
    readonly onHover: (mesh: Mesh | null) => void;
}

function wirePointerHandler(input: PointerWireInput): () => void {
    const onClick = (event: PointerEvent): void => {
        updatePointerFromEvent(input.host, event, input.pointer);
        const hit = pickMesh(input);
        if (hit) input.onPick(hit);
    };
    const onMove = (event: PointerEvent): void => {
        updatePointerFromEvent(input.host, event, input.pointer);
        input.onHover(pickMesh(input));
    };
    const onLeave = (): void => input.onHover(null);

    input.host.addEventListener('click', onClick);
    input.host.addEventListener('pointermove', onMove);
    input.host.addEventListener('pointerleave', onLeave);
    return () => {
        input.host.removeEventListener('click', onClick);
        input.host.removeEventListener('pointermove', onMove);
        input.host.removeEventListener('pointerleave', onLeave);
    };
}

function pickMesh(input: PointerWireInput): Mesh | null {
    input.raycaster.setFromCamera(input.pointer, input.camera);
    const hit = input.raycaster.intersectObjects(
        input.getMeshes() as Mesh[],
        false
    )[0];
    return (hit?.object as Mesh | undefined) ?? null;
}

function updatePointerFromEvent(
    host: HTMLElement,
    event: PointerEvent,
    pointer: Vector2
): void {
    const rect = host.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
}

function setHoveredMesh(mesh: Mesh | null): void {
    if (!mesh) {
        hoveredId.value = null;
        return;
    }
    hoveredId.value = state?.floorIdByMesh.get(mesh) ?? null;
}

function emitFloorPick(mesh: Mesh): void {
    const id = state?.floorIdByMesh.get(mesh);
    if (id == null) return;
    emit('open', id);
}

function handleResize(input: {
    readonly renderer: WebGLRenderer;
    readonly camera: PerspectiveCamera;
    readonly host: HTMLElement;
}): void {
    const width = input.host.clientWidth;
    const height = input.host.clientHeight;
    if (width === 0 || height === 0) return;
    input.renderer.setSize(width, height);
    input.camera.aspect = width / height;
    input.camera.updateProjectionMatrix();
}

function stopRenderLoop(sceneState: SceneState): void {
    if (sceneState.rafId != null) window.cancelAnimationFrame(sceneState.rafId);
    sceneState.rafId = null;
}
</script>

<style scoped>
.lbfs {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 360px;
}

.lbfs__canvas {
    position: absolute;
    inset: 0;
    background:
        radial-gradient(
            ellipse at center,
            rgba(var(--color-primary-rgb), 0.06),
            transparent 70%
        );
}

/* Top-left floor selector (Verkada/Meraki pattern). */
.lbfs__selector {
    position: absolute;
    left: var(--space-4);
    top: var(--space-4);
    z-index: 2;
    pointer-events: auto;
}

.lbfs__hover-pill {
    position: absolute;
    top: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    pointer-events: none;
    padding: var(--space-1-5) var(--space-3);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-full);
    box-shadow:
        inset 0 1px 0 var(--glass-highlight),
        0 8px 24px rgba(0, 0, 0, 0.35);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    white-space: nowrap;
}

.lbfs__empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--color-text-tertiary);
    padding: var(--space-8);
}

.lbfs__empty-title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-2);
}

.lbfs__empty-sub {
    font-size: var(--type-caption);
    margin: 0;
    max-width: 36ch;
}
</style>
