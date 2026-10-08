// 3D floor-plan Three.js scene. Tunables in constants.ts (env-overridable);
// brand colours read from design-tokens.css at scene init.

import {
    AmbientLight,
    BoxGeometry,
    type BufferGeometry,
    CanvasTexture,
    Color,
    DirectionalLight,
    DoubleSide,
    ExtrudeGeometry,
    Group,
    InstancedMesh,
    LinearFilter,
    type Material,
    Matrix4,
    Mesh,
    MeshLambertMaterial,
    MeshStandardMaterial,
    type Object3D,
    PerspectiveCamera,
    Plane,
    PlaneGeometry,
    Raycaster,
    Scene,
    Shape,
    Sprite,
    SpriteMaterial,
    SRGBColorSpace,
    Texture,
    TextureLoader,
    Vector2,
    Vector3,
    WebGLRenderer
} from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import type {FloorPlanDevice} from '@/components/core/FloorPlanCanvas.vue';
import {
    FLOORPLAN_3D_AMBIENT_INTENSITY,
    FLOORPLAN_3D_AUTO_ORBIT_RAD_PER_SEC,
    FLOORPLAN_3D_CAMERA_DIST,
    FLOORPLAN_3D_CAMERA_FOV,
    FLOORPLAN_3D_CAMERA_HEIGHT,
    FLOORPLAN_3D_CLICK_FLASH_MS,
    FLOORPLAN_3D_CLICK_THRESHOLD_PX,
    FLOORPLAN_3D_DBLCLICK_MS,
    FLOORPLAN_3D_FAR_PLANE,
    FLOORPLAN_3D_FILL_INTENSITY,
    FLOORPLAN_3D_FLYTO_MS,
    FLOORPLAN_3D_HOVER_EMISSIVE_BOOST,
    FLOORPLAN_3D_HOVER_LERP,
    FLOORPLAN_3D_HOVER_SCALE,
    FLOORPLAN_3D_IDLE_ORBIT_MS,
    FLOORPLAN_3D_INSTANCE_THRESHOLD,
    FLOORPLAN_3D_KEY_INTENSITY,
    FLOORPLAN_3D_LABEL_OFFSET_Y,
    FLOORPLAN_3D_LABEL_OPACITY,
    FLOORPLAN_3D_MAX_POLAR_RATIO,
    FLOORPLAN_3D_NEAR_PLANE,
    FLOORPLAN_3D_ORBIT_DAMPING,
    FLOORPLAN_3D_ORBIT_MAX_DIST,
    FLOORPLAN_3D_ORBIT_MIN_DIST,
    FLOORPLAN_3D_PIN_HEIGHT,
    FLOORPLAN_3D_PIN_RADIUS,
    FLOORPLAN_3D_PIXEL_RATIO_CAP,
    FLOORPLAN_3D_PLAN_SIZE,
    FLOORPLAN_3D_WALL_HEIGHT,
    FLOORPLAN_3D_WALL_OPACITY
} from '@/constants';
import {isAutoPlaced} from '@/helpers/auto-placement';
import {
    buildFixtureMesh,
    getFixture,
    onFixtureGlbReady
} from '@/helpers/fixture-registry';
import {
    BLANK_PLAN_RECT,
    type FloorSize,
    normalizedToWorld as normalizedToWorldXZ,
    type PlanRect,
    worldToNormalizedXY
} from '@/helpers/floor-plan-coords';
import {floorPlanPlacementId} from '@/helpers/floor-plan-device-identity';
import {type DrawDraft, draftSegments} from '@/helpers/floor-plan-draw';
import {MIN_WALL_LENGTH, normalizeSvgWalls} from '@/helpers/floor-plan-walls';
import {isSvgPlanUrl, stripInkscapeBaseLayer} from '@/helpers/svg-floorplan';
import {loadSvgFloorPlanGeometry} from '@/helpers/svg-walls';
import type {
    DevicePlacementMap,
    FloorPlanRef,
    PlanPoint,
    WallSegment,
    ZoneShape
} from '@/types/floor-plan';

// Module-local structural constants (single source of truth within this
// module). Not env-tunable because they're implementation detail —
// changing them requires re-tuning the rest of the scene.
const FLOOR_Y_OFFSET = -0.01;
const FLOOR_ROUGHNESS = 0.85;
const FLOOR_METALNESS = 0;
const PIN_ROUGHNESS = 0.4;
const PIN_METALNESS = 0.25;
const PIN_EMISSIVE_INTENSITY = 0.25;
const KEY_LIGHT_POS: [number, number, number] = [40, 80, 40];
const FILL_LIGHT_POS: [number, number, number] = [-60, 40, -30];
const LABEL_CANVAS_W = 256;
const LABEL_CANVAS_H = 64;
const LABEL_SPRITE_SCALE: [number, number, number] = [7, 1.75, 1];
const LABEL_FONT = '600 24px Instrument Sans, system-ui, sans-serif';
const KEY_LIGHT_COLOR = '#ffffff';

const MATERIAL_TEXTURE_KEYS = [
    'map',
    'normalMap',
    'roughnessMap',
    'metalnessMap',
    'emissiveMap',
    'aoMap',
    'alphaMap',
    'bumpMap',
    'displacementMap',
    'lightMap',
    'envMap'
] as const;

export type CameraView = 'top' | 'iso' | 'free';
export type SceneLayer = 'floor' | 'walls' | 'devices';

export interface FloorPlanScene {
    mount(el: HTMLElement): void;
    update(input: SceneInput): void;
    onDeviceClick(handler: (id: string) => void): void;
    /** Fired during drag-to-place when edit mode is on. Coords are
     *  normalized 0..1 against the floor bbox. */
    onDeviceMove(
        handler: (id: string, position: {x: number; y: number}) => void
    ): void;
    /** Fired when a click lands while a draw draft is active. Same
     *  normalized 0..1 contract the 2D canvas emits, so one draw pipeline
     *  serves both renderers. */
    onDraftVertex(handler: (point: PlanPoint) => void): void;
    /** Screen point → normalized 0..1 floor coords. Exposed because a
     *  perspective camera makes the host's flat screen-rect fractions
     *  wrong; HTML5 drops must be projected onto the floor plane. */
    normalizedPointAt(
        clientX: number,
        clientY: number
    ): {x: number; y: number} | null;
    setView(view: CameraView): void;
    setLighting(mode: LightingMode): void;
    setLayerVisibility(layer: SceneLayer, visible: boolean): void;
    /** Toggles orbit suspension + enables device drag handling. */
    setEditMode(enabled: boolean): void;
    dispose(): void;
}

export interface SceneInput {
    plan: FloorPlanRef | null;
    zones: ZoneShape[];
    /** Hand-drawn walls, persisted in kindFields. Extracted walls are
     *  derived from the plan file and never appear here — both end up in
     *  the same extruder regardless. */
    walls: WallSegment[];
    placements: DevicePlacementMap;
    devices: FloorPlanDevice[];
    /** The in-progress zone or wall, or null. Non-null also arms vertex
     *  capture: a click then places a vertex instead of picking a device. */
    draft: DrawDraft | null;
}

interface BrandPalette {
    bg: Color;
    ambient: Color;
    fill: Color;
    floor: Color;
    defaultZone: Color;
    labelBg: string;
    labelText: string;
}

interface FixtureAnim {
    group: Object3D;
    hover: number;
    baseEmissive: Map<Mesh, number>;
}

interface CameraTween {
    fromPos: Vector3;
    toPos: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    startTime: number;
    durationMs: number;
}

interface SceneLights {
    ambient: AmbientLight;
    key: DirectionalLight;
    fill: DirectionalLight;
}

interface InternalState {
    scene: Scene;
    camera: PerspectiveCamera;
    renderer: WebGLRenderer;
    controls: OrbitControls;
    floorGroup: Group;
    /** Translucent volumes extruded from zone polygons — not walls, but
     *  they share the `walls` layer toggle users already know. */
    zoneVolumesGroup: Group;
    /** Walls auto-extracted from an uploaded SVG. */
    extractedWallsGroup: Group;
    /** Walls drawn by hand and persisted in kindFields. */
    drawnWallsGroup: Group;
    /** Live preview of the draft being drawn. Deliberately outside the
     *  layer toggles: hiding what you are drawing is never useful. */
    draftGroup: Group;
    devicesGroup: Group;
    lights: SceneLights;
    palette: BrandPalette;
    resizeObserver: ResizeObserver | null;
    rafId: number | null;
    host: HTMLElement | null;
    clickHandler: ((id: string) => void) | null;
    moveHandler:
        | ((id: string, position: {x: number; y: number}) => void)
        | null;
    vertexHandler: ((point: PlanPoint) => void) | null;
    /** Mirrors `SceneInput.draft !== null`. Read on every pointer event, so
     *  it is cached rather than re-derived from lastInput. */
    draftActive: boolean;
    editMode: boolean;
    /** Floor footprint in world units — used to normalize a drag target
     *  back into 0..1 coords the rest of the app stores in
     *  `kindFields.devicePlacements`. */
    floorSize: FloorSize | null;
    raycaster: Raycaster;
    pointer: Vector2;
    onPointer: ((e: PointerEvent) => void) | null;
    onPointerMove: ((e: PointerEvent) => void) | null;
    pointerAbort: AbortController;
    floorLoadSeq: number;
    /** Plan URL the floor layers were built from, or BLANK_FLOOR_KEY when
     *  there is no plan. Guards against re-fetching + re-parsing the SVG on
     *  every prop tick. */
    lastFloorUrl: string | null;
    /** Walls extracted from the current SVG plan, already normalized into
     *  the shared model. Empty for raster plans and for SVGs with no
     *  readable geometry. */
    extractedWalls: WallSegment[];
    disposed: boolean;
    fixtureAnims: Map<string, FixtureAnim>;
    hoveredDeviceId: string | null;
    clickFlashes: Map<string, number>;
    lastClickTime: Map<string, number>;
    activeTween: CameraTween | null;
    /** device id → placement key. Meshes are tagged with the device id so
     *  clicks report a device, but `kindFields.devicePlacements` is keyed
     *  by placement id — a drag must emit the placement key or it writes a
     *  second, orphaned entry. */
    placementIds: Map<string, string>;
    /** Render-on-demand flag. Event handlers + scene updates set this
     *  true; tick clears it after rendering. RAF stops when this is
     *  false AND no animations are active. */
    needsRender: boolean;
    /** performance.now() of last user interaction. Drives auto-orbit
     *  idle threshold; reset on pointermove / pointerdown / wheel. */
    lastInputTime: number;
    /** performance.now() of last animate frame; used for delta-time
     *  in time-based animations like auto-orbit. */
    lastFrameTime: number;
    /** Cached most-recent scene input so the renderer can rebuild
     *  devices when async assets (fixture GLBs) finish loading. */
    lastInput: SceneInput | null;
    /** Unsubscribe from the fixture-registry's GLB-ready event. */
    unsubscribeGlbReady: (() => void) | null;
}

// ───── PUBLIC ────────────────────────────────────────────────────────

export function createFloorPlanScene(): FloorPlanScene {
    const state = initScene();
    // Rebuild devices when any fixture GLB becomes available — swaps
    // primitives for real models without a prop change from the parent.
    state.unsubscribeGlbReady = onFixtureGlbReady(() => {
        if (state.disposed || !state.lastInput) return;
        updateDevices(
            state,
            state.lastInput.devices,
            state.lastInput.placements
        );
        markNeedsRender(state);
    });
    return {
        mount: (el) => attachToHost(state, el),
        update: (input) => {
            state.lastInput = input;
            updateFloor(state, input.plan);
            updateZoneVolumes(state, input.zones);
            updateDrawnWalls(state, input.walls);
            updateDraft(state, input.draft);
            updateDevices(state, input.devices, input.placements);
            markNeedsRender(state);
        },
        onDeviceClick: (handler) => {
            state.clickHandler = handler;
        },
        onDeviceMove: (handler) => {
            state.moveHandler = handler;
        },
        onDraftVertex: (handler) => {
            state.vertexHandler = handler;
        },
        normalizedPointAt: (clientX, clientY) =>
            normalizedPointAt(state, clientX, clientY),
        setView: (view) => flyCameraToView(state, view),
        setLighting: (mode) => applyLightingPreset(state, mode),
        setLayerVisibility: (layer, visible) =>
            setLayerVisibility(state, layer, visible),
        setEditMode: (enabled) => setEditMode(state, enabled),
        dispose: () => disposeScene(state)
    };
}

// Edit mode keeps orbit: you cannot draw a wall on a face you cannot see,
// and D-032 requires drawing to work in 3D. Orbit is suspended per gesture
// instead — only while a drag that started on a device is in flight, which
// is the same rule the 2D stage applies with `viewport.pause`.
function setEditMode(state: InternalState, enabled: boolean): void {
    state.editMode = enabled;
}

// Dispatch by layer key — each entry returns the groups it owns. New layers
// just add an entry; no branching to grow.
const LAYER_GROUPS: Record<SceneLayer, (s: InternalState) => readonly Group[]> =
    {
        floor: (s) => [s.floorGroup],
        walls: (s) => [
            s.zoneVolumesGroup,
            s.extractedWallsGroup,
            s.drawnWallsGroup
        ],
        devices: (s) => [s.devicesGroup]
    };

function setLayerVisibility(
    state: InternalState,
    layer: SceneLayer,
    visible: boolean
): void {
    for (const group of LAYER_GROUPS[layer](state)) group.visible = visible;
    markNeedsRender(state);
}

// Camera preset tweens. 'free' returns to the default orbit position.
function flyCameraToView(state: InternalState, view: CameraView): void {
    const presets = cameraPresetPositions();
    const next = presets[view];
    state.activeTween = {
        fromPos: state.camera.position.clone(),
        toPos: next.position,
        fromTarget: state.controls.target.clone(),
        toTarget: next.target,
        startTime: performance.now(),
        durationMs: FLOORPLAN_3D_FLYTO_MS
    };
    markNeedsRender(state);
}

function cameraPresetPositions(): Record<
    CameraView,
    {position: Vector3; target: Vector3}
> {
    const center = new Vector3(0, 0, 0);
    return {
        top: {
            position: new Vector3(0, FLOORPLAN_3D_CAMERA_DIST * 1.4, 0.001),
            target: center.clone()
        },
        iso: {
            position: new Vector3(
                FLOORPLAN_3D_CAMERA_DIST * 0.7,
                FLOORPLAN_3D_CAMERA_HEIGHT,
                FLOORPLAN_3D_CAMERA_DIST * 0.7
            ),
            target: center.clone()
        },
        free: {
            position: new Vector3(
                0,
                FLOORPLAN_3D_CAMERA_HEIGHT,
                FLOORPLAN_3D_CAMERA_DIST
            ),
            target: center.clone()
        }
    };
}

// Request a render frame and kick the RAF loop if it's not already
// running. Called by event handlers + scene mutations.
function markNeedsRender(state: InternalState): void {
    state.needsRender = true;
    if (state.rafId === null && !state.disposed) {
        state.rafId = requestAnimationFrame(() => tick(state));
    }
}

function recordInput(state: InternalState): void {
    state.lastInputTime = performance.now();
    markNeedsRender(state);
}

// ───── INIT ──────────────────────────────────────────────────────────

function initScene(): InternalState {
    const palette = readBrandPalette();
    const scene = new Scene();
    scene.background = palette.bg;

    const camera = new PerspectiveCamera(
        FLOORPLAN_3D_CAMERA_FOV,
        1,
        FLOORPLAN_3D_NEAR_PLANE,
        FLOORPLAN_3D_FAR_PLANE
    );
    camera.position.set(
        0,
        FLOORPLAN_3D_CAMERA_HEIGHT,
        FLOORPLAN_3D_CAMERA_DIST
    );

    const renderer = new WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(
        Math.min(window.devicePixelRatio, FLOORPLAN_3D_PIXEL_RATIO_CAP)
    );

    const controls = makeOrbitControls(camera, renderer);
    const lights = addLights(scene, palette);

    const floorGroup = new Group();
    const zoneVolumesGroup = new Group();
    const extractedWallsGroup = new Group();
    const drawnWallsGroup = new Group();
    const draftGroup = new Group();
    const devicesGroup = new Group();
    scene.add(
        floorGroup,
        zoneVolumesGroup,
        extractedWallsGroup,
        drawnWallsGroup,
        draftGroup,
        devicesGroup
    );

    return {
        scene,
        camera,
        renderer,
        controls,
        floorGroup,
        zoneVolumesGroup,
        extractedWallsGroup,
        drawnWallsGroup,
        draftGroup,
        devicesGroup,
        lights,
        palette,
        resizeObserver: null,
        rafId: null,
        host: null,
        clickHandler: null,
        moveHandler: null,
        vertexHandler: null,
        draftActive: false,
        editMode: false,
        floorSize: null,
        raycaster: new Raycaster(),
        pointer: new Vector2(),
        onPointer: null,
        onPointerMove: null,
        pointerAbort: new AbortController(),
        floorLoadSeq: 0,
        lastFloorUrl: null,
        extractedWalls: [],
        disposed: false,
        fixtureAnims: new Map(),
        hoveredDeviceId: null,
        clickFlashes: new Map(),
        lastClickTime: new Map(),
        activeTween: null,
        placementIds: new Map(),
        needsRender: true,
        lastInputTime: performance.now(),
        lastFrameTime: performance.now(),
        lastInput: null,
        unsubscribeGlbReady: null
    };
}

function makeOrbitControls(
    camera: PerspectiveCamera,
    renderer: WebGLRenderer
): OrbitControls {
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = FLOORPLAN_3D_ORBIT_DAMPING;
    controls.minDistance = FLOORPLAN_3D_ORBIT_MIN_DIST;
    controls.maxDistance = FLOORPLAN_3D_ORBIT_MAX_DIST;
    // Cap polar angle so the camera never dips below the floor plane.
    controls.maxPolarAngle = Math.PI / FLOORPLAN_3D_MAX_POLAR_RATIO;
    return controls;
}

function addLights(scene: Scene, palette: BrandPalette): SceneLights {
    const ambient = new AmbientLight(
        palette.ambient,
        FLOORPLAN_3D_AMBIENT_INTENSITY
    );
    scene.add(ambient);
    const key = new DirectionalLight(
        KEY_LIGHT_COLOR,
        FLOORPLAN_3D_KEY_INTENSITY
    );
    key.position.set(...KEY_LIGHT_POS);
    scene.add(key);
    const fill = new DirectionalLight(
        palette.fill,
        FLOORPLAN_3D_FILL_INTENSITY
    );
    fill.position.set(...FILL_LIGHT_POS);
    scene.add(fill);
    return {ambient, key, fill};
}

const LIGHTING_PRESETS = {
    day: {ambientI: 1, keyI: 1, fillI: 1, ambient: '#aae1fa', key: '#ffffff'},
    night: {
        ambientI: 0.35,
        keyI: 0.45,
        fillI: 0.45,
        ambient: '#1c2a4d',
        key: '#e8b554'
    },
    alert: {
        ambientI: 0.55,
        keyI: 0.9,
        fillI: 0.6,
        ambient: '#ff5c5c',
        key: '#ffd9d9'
    }
} as const;

export type LightingMode = keyof typeof LIGHTING_PRESETS;

function applyLightingPreset(state: InternalState, mode: LightingMode): void {
    const preset = LIGHTING_PRESETS[mode];
    state.lights.ambient.intensity =
        FLOORPLAN_3D_AMBIENT_INTENSITY * preset.ambientI;
    state.lights.ambient.color.set(preset.ambient);
    state.lights.key.intensity = FLOORPLAN_3D_KEY_INTENSITY * preset.keyI;
    state.lights.key.color.set(preset.key);
    state.lights.fill.intensity = FLOORPLAN_3D_FILL_INTENSITY * preset.fillI;
    markNeedsRender(state);
}

function readBrandPalette(): BrandPalette {
    const css = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: string): string =>
        css.getPropertyValue(name).trim() || fallback;
    return {
        bg: new Color(get('--color-surface-bg', '#0a1424')),
        ambient: new Color(get('--brand-light', '#aae1fa')),
        fill: new Color(get('--brand-blue', '#4495d1')),
        floor: new Color(get('--color-surface-3', '#122338')),
        defaultZone: new Color(get('--brand-blue', '#4495d1')),
        labelBg: get('--color-surface-2', '#0d1b2e'),
        labelText: get('--color-text-primary', '#eaf4ff')
    };
}

// ───── LIFECYCLE ─────────────────────────────────────────────────────

function attachToHost(state: InternalState, host: HTMLElement): void {
    state.host = host;
    host.appendChild(state.renderer.domElement);
    state.renderer.domElement.style.display = 'block';
    state.renderer.domElement.style.width = '100%';
    state.renderer.domElement.style.height = '100%';

    state.resizeObserver = new ResizeObserver(() => resize(state));
    state.resizeObserver.observe(host);
    resize(state);

    state.onPointer = (e) => handlePointerDown(state, e);
    state.renderer.domElement.addEventListener('pointerdown', state.onPointer);
    state.onPointerMove = (e) => handlePointerMove(state, e);
    state.renderer.domElement.addEventListener(
        'pointermove',
        state.onPointerMove
    );
    // OrbitControls fires 'change' on user drag, programmatic camera
    // moves (auto-orbit, fly-to), AND damping settle. Use it to keep
    // the render loop awake without needing per-input plumbing.
    state.controls.addEventListener('change', () => markNeedsRender(state));

    // Initial render — paints the scene once even if nothing else
    // triggers an event before the user interacts.
    state.rafId = requestAnimationFrame(() => tick(state));
}

function resize(state: InternalState): void {
    if (!state.host) return;
    const w = state.host.clientWidth;
    const h = state.host.clientHeight;
    if (w === 0 || h === 0) return;
    state.renderer.setSize(w, h, false);
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    markNeedsRender(state);
}

// Render-on-demand tick. Runs only when something needs rendering
// (animations active OR explicit needsRender). Stops RAF when idle —
// idle CPU drops near zero while the scene is visible but unchanged.
function tick(state: InternalState): void {
    if (state.disposed) {
        state.rafId = null;
        return;
    }
    const now = performance.now();
    const dt = Math.min((now - state.lastFrameTime) / 1000, 0.1);
    state.lastFrameTime = now;

    stepCameraTween(state, now);
    stepFixtureAnims(state, now);
    stepAutoOrbit(state, {dt, now});
    state.controls.update();
    state.renderer.render(state.scene, state.camera);
    state.needsRender = false;

    if (hasActiveAnimations(state)) {
        state.rafId = requestAnimationFrame(() => tick(state));
    } else {
        state.rafId = null;
    }
}

function hasActiveAnimations(state: InternalState): boolean {
    if (state.needsRender) return true;
    if (state.activeTween !== null) return true;
    if (state.clickFlashes.size > 0) return true;
    if (state.hoveredDeviceId !== null) return true;
    // Hover lerp still settling on at least one fixture.
    for (const anim of state.fixtureAnims.values()) {
        if (anim.hover > 0.001) return true;
    }
    // Auto-orbit active.
    if (performance.now() - state.lastInputTime > FLOORPLAN_3D_IDLE_ORBIT_MS) {
        return true;
    }
    return false;
}

function stepAutoOrbit(
    state: InternalState,
    tick: {dt: number; now: number}
): void {
    if (state.activeTween !== null) return; // fly-to wins
    const idleMs = tick.now - state.lastInputTime;
    if (idleMs < FLOORPLAN_3D_IDLE_ORBIT_MS) return;
    const angle = FLOORPLAN_3D_AUTO_ORBIT_RAD_PER_SEC * tick.dt;
    const offset = state.camera.position.clone().sub(state.controls.target);
    offset.applyAxisAngle(YAXIS, angle);
    state.camera.position.copy(state.controls.target).add(offset);
}

const YAXIS = new Vector3(0, 1, 0);

// Per-frame: lerp hover values, decay click flashes, apply to fixtures.
function stepFixtureAnims(state: InternalState, now: number): void {
    for (const [deviceId, anim] of state.fixtureAnims) {
        const targetHover = deviceId === state.hoveredDeviceId ? 1 : 0;
        anim.hover += (targetHover - anim.hover) * FLOORPLAN_3D_HOVER_LERP;
        if (Math.abs(targetHover - anim.hover) < 0.001)
            anim.hover = targetHover;

        // Click-flash curve — quick squash then settle. Returns 0 when expired.
        const flashStart = state.clickFlashes.get(deviceId);
        let flashScale = 0;
        let flashEmissive = 0;
        if (flashStart !== undefined) {
            const elapsed = now - flashStart;
            if (elapsed >= FLOORPLAN_3D_CLICK_FLASH_MS) {
                state.clickFlashes.delete(deviceId);
            } else {
                const t = elapsed / FLOORPLAN_3D_CLICK_FLASH_MS;
                // Squash 0..0.28 → -0.04 scale, then settle back.
                flashScale =
                    t < 0.28
                        ? -0.04 * (t / 0.28)
                        : -0.04 * (1 - (t - 0.28) / 0.72);
                // Emissive flash to +0.55 within first 80ms, decay rest.
                flashEmissive =
                    t < 0.25
                        ? 0.55 * (t / 0.25)
                        : 0.55 * (1 - (t - 0.25) / 0.75);
            }
        }

        const scale = 1 + anim.hover * FLOORPLAN_3D_HOVER_SCALE + flashScale;
        anim.group.scale.setScalar(scale);

        const emissiveBoost =
            anim.hover * FLOORPLAN_3D_HOVER_EMISSIVE_BOOST + flashEmissive;
        for (const [mesh, base] of anim.baseEmissive) {
            const mat = mesh.material as MeshStandardMaterial;
            mat.emissiveIntensity = base + emissiveBoost;
        }
    }
}

function stepCameraTween(state: InternalState, now: number): void {
    if (!state.activeTween) return;
    const t =
        (now - state.activeTween.startTime) / state.activeTween.durationMs;
    if (t >= 1) {
        state.camera.position.copy(state.activeTween.toPos);
        state.controls.target.copy(state.activeTween.toTarget);
        state.activeTween = null;
        return;
    }
    // cubic-bezier(0.16, 1, 0.3, 1) ease-out-expo approximation.
    const eased = 1 - (1 - t) ** 4;
    state.camera.position.lerpVectors(
        state.activeTween.fromPos,
        state.activeTween.toPos,
        eased
    );
    state.controls.target.lerpVectors(
        state.activeTween.fromTarget,
        state.activeTween.toTarget,
        eased
    );
}

function disposeScene(state: InternalState): void {
    state.disposed = true;
    if (state.rafId !== null) cancelAnimationFrame(state.rafId);
    state.resizeObserver?.disconnect();
    if (state.onPointer) {
        state.renderer.domElement.removeEventListener(
            'pointerdown',
            state.onPointer
        );
    }
    if (state.onPointerMove) {
        state.renderer.domElement.removeEventListener(
            'pointermove',
            state.onPointerMove
        );
    }
    state.pointerAbort.abort();
    clearGroup(state.floorGroup);
    clearGroup(state.zoneVolumesGroup);
    clearGroup(state.extractedWallsGroup);
    clearGroup(state.drawnWallsGroup);
    clearGroup(state.draftGroup);
    clearGroup(state.devicesGroup);
    state.fixtureAnims.clear();
    state.placementIds.clear();
    state.clickFlashes.clear();
    state.lastClickTime.clear();
    state.unsubscribeGlbReady?.();
    state.unsubscribeGlbReady = null;
    state.lastInput = null;
    state.controls.dispose();
    state.renderer.dispose();
    state.renderer.domElement.remove();
    state.host = null;
}

// ───── FLOOR ─────────────────────────────────────────────────────────

// Sentinel for "no plan uploaded". A floor with no drawing is a real,
// supported state (D-032), not an absence — it still gets a surface, a
// fixed size and everything drawn on it.
const BLANK_FLOOR_KEY = 'fm:no-plan';

function updateFloor(state: InternalState, plan: FloorPlanRef | null): void {
    const key = isValidPlan(plan) ? plan.url : BLANK_FLOOR_KEY;
    if (key === state.lastFloorUrl) return;
    resetFloorLayers(state);
    const seq = ++state.floorLoadSeq;
    state.lastFloorUrl = key;
    // Size is known from the plan's own pixel dimensions, so it is set
    // before the texture request goes out. Without that, a vertex clicked
    // during the load has no rect to normalize against and is dropped.
    state.floorSize = floorSizeFor(isValidPlan(plan) ? plan : BLANK_PLAN_RECT);
    if (!isValidPlan(plan)) {
        addPlainFloor(state, state.floorSize);
        rerenderLayersForFloorSize(state);
        markNeedsRender(state);
        return;
    }
    void rebuildFloorAndWalls(state, seq, plan, state.floorSize);
}

// Clears every plan-derived group + URL trackers. One place owns the
// "no plan visible" invariant so callers can't leak stale walls.
function resetFloorLayers(state: InternalState): void {
    clearGroup(state.floorGroup);
    clearGroup(state.extractedWallsGroup);
    state.lastFloorUrl = null;
    state.extractedWalls = [];
}

function floorSizeFor(rect: PlanRect): FloorSize {
    const aspect = rect.heightPx / rect.widthPx;
    return {
        planW: FLOORPLAN_3D_PLAN_SIZE,
        planH: FLOORPLAN_3D_PLAN_SIZE * aspect
    };
}

// Awaits the texture and the wall-extraction in parallel, then decides
// once: walls won → plain floor + extruded walls; walls failed (PNG/JPG
// or non-architectural SVG) → SVG as floor texture. No race, no double-add.
async function rebuildFloorAndWalls(
    state: InternalState,
    seq: number,
    plan: FloorPlanRef,
    size: FloorSize
): Promise<void> {
    const [texture, geom] = await Promise.all([
        loadFloorTexture(plan.url),
        loadSvgFloorPlanGeometry(plan.url).catch(() => null)
    ]);
    if (state.disposed || seq !== state.floorLoadSeq) {
        texture?.dispose();
        return;
    }
    // floorSize was set synchronously by updateFloor from the plan's own
    // pixel dimensions; nothing about the texture or the parse changes it.
    // Normalized on arrival, so from here on an extracted wall and a
    // hand-drawn wall are indistinguishable to everything downstream.
    state.extractedWalls = normalizeSvgWalls(geom);
    if (state.extractedWalls.length > 0) {
        renderExtractedWalls(state);
        addPlainFloor(state, size);
        fitCameraToWalls(state, size);
        texture?.dispose();
    } else if (texture) {
        applyFloorTexture(state, seq, texture, size.planW, size.planH);
    }
    rerenderLayersForFloorSize(state);
    markNeedsRender(state);
}

// Re-runs the layers that depend on `state.floorSize`. `scene.update` always
// calls them synchronously before the async floor load resolves, so they
// initially render against the square fallback. Without this, zone walls
// and device pins stay frozen at fallback positions for non-square plans
// until the next prop change happens to fire `scene.update` again.
function rerenderLayersForFloorSize(state: InternalState): void {
    if (!state.lastInput) return;
    updateZoneVolumes(state, state.lastInput.zones);
    updateDrawnWalls(state, state.lastInput.walls);
    updateDraft(state, state.lastInput.draft);
    updateDevices(state, state.lastInput.devices, state.lastInput.placements);
}

// Resolves to a texture (null on failure) so Promise.all can proceed.
// For SVGs we fetch + strip the Inkscape Base layer first so the baked-in
// white page background doesn't end up rasterized into the floor texture.
function loadFloorTexture(url: string): Promise<Texture | null> {
    return new Promise(async (resolve) => {
        const sourceUrl = await prepareTextureUrl(url);
        const loader = new TextureLoader();
        loader.setCrossOrigin('anonymous');
        loader.load(
            sourceUrl,
            (tex) => {
                if (sourceUrl !== url) URL.revokeObjectURL(sourceUrl);
                resolve(tex);
            },
            undefined,
            (err) => {
                if (sourceUrl !== url) URL.revokeObjectURL(sourceUrl);
                console.warn(
                    '[floor-plan-3d] floor texture load failed',
                    url,
                    err
                );
                resolve(null);
            }
        );
    });
}

async function prepareTextureUrl(url: string): Promise<string> {
    if (!isSvgPlanUrl(url)) return url;
    try {
        const response = await fetch(url);
        if (!response.ok) return url;
        const text = await response.text();
        const stripped = stripInkscapeBaseLayer(text);
        if (stripped === text) return url;
        return URL.createObjectURL(
            new Blob([stripped], {type: 'image/svg+xml'})
        );
    } catch {
        return url;
    }
}

function addPlainFloor(state: InternalState, size: FloorSize): void {
    const geom = new PlaneGeometry(size.planW, size.planH);
    geom.rotateX(-Math.PI / 2);
    const mat = new MeshStandardMaterial({
        color: state.palette.floor,
        roughness: FLOOR_ROUGHNESS,
        metalness: FLOOR_METALNESS
    });
    const mesh = new Mesh(geom, mat);
    mesh.position.y = FLOOR_Y_OFFSET;
    state.floorGroup.add(mesh);
}

const WALL_THICKNESS = 0.8;
const WALL_HEIGHT_MULT = 1.6; // taller than the translucent zone volumes
const WALL_COLOR = 0xe8ecf1;
// The draft reads as unfinished: shorter and see-through until committed.
const DRAFT_WALL_HEIGHT_MULT = 0.5;
const DRAFT_OPACITY = 0.55;
const DRAFT_VERTEX_SIZE = 0.9;
const CAMERA_FIT_PADDING = 1.3;
const CAMERA_FIT_HEIGHT_RATIO = 0.65;
const CAMERA_FIT_DEPTH_RATIO = 0.75;

function fitCameraToWalls(state: InternalState, size: FloorSize): void {
    const halfFov = (state.camera.fov * Math.PI) / 360;
    const diag = Math.hypot(size.planW, size.planH);
    const distance = (diag / 2 / Math.tan(halfFov)) * CAMERA_FIT_PADDING;
    state.activeTween = {
        fromPos: state.camera.position.clone(),
        toPos: new Vector3(
            0,
            distance * CAMERA_FIT_HEIGHT_RATIO,
            distance * CAMERA_FIT_DEPTH_RATIO
        ),
        fromTarget: state.controls.target.clone(),
        toTarget: new Vector3(0, 0, 0),
        startTime: performance.now(),
        durationMs: FLOORPLAN_3D_FLYTO_MS
    };
}

interface WallStyle {
    readonly color: number;
    readonly height: number;
    readonly opacity?: number;
}

/** The one wall extruder.
 *
 *  Extracted walls, hand-drawn walls and the live draft preview all arrive
 *  here as normalized segments — that is the whole point of the shared
 *  model. One wall look, and one place a geometry bug can hide.
 *
 *  The material is built per call and owned by the group, so clearing the
 *  group disposes it. */
function addWallSegments(
    group: Group,
    segments: readonly WallSegment[],
    size: FloorSize | null,
    style: WallStyle
): void {
    if (segments.length === 0) return;
    const mat = new MeshStandardMaterial({
        color: style.color,
        roughness: 0.9,
        metalness: 0,
        transparent: style.opacity !== undefined,
        opacity: style.opacity ?? 1
    });
    // The model's own minimum, carried into world units. Taking the smaller
    // side keeps the cull conservative on a non-square plan: nothing the
    // model chose to keep is silently dropped by the renderer.
    const minLength =
        MIN_WALL_LENGTH *
        Math.min(
            size?.planW ?? FLOORPLAN_3D_PLAN_SIZE,
            size?.planH ?? FLOORPLAN_3D_PLAN_SIZE
        );
    for (const seg of segments) {
        const a = normalizedToWorld(seg.from, size);
        const b = normalizedToWorld(seg.to, size);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        if (length < minLength) continue;
        const box = new BoxGeometry(length, style.height, WALL_THICKNESS);
        const mesh = new Mesh(box, mat);
        mesh.position.set((a.x + b.x) / 2, style.height / 2, (a.z + b.z) / 2);
        mesh.rotation.y = -Math.atan2(dz, dx);
        group.add(mesh);
    }
}

function wallHeight(): number {
    return FLOORPLAN_3D_WALL_HEIGHT * WALL_HEIGHT_MULT;
}

function renderExtractedWalls(state: InternalState): void {
    clearGroup(state.extractedWallsGroup);
    addWallSegments(
        state.extractedWallsGroup,
        state.extractedWalls,
        state.floorSize,
        {color: WALL_COLOR, height: wallHeight()}
    );
}

// Drawn walls render identically to extracted ones — once saved they are
// the floor's walls, and marking them as second-class would be a lie.
function updateDrawnWalls(
    state: InternalState,
    walls: readonly WallSegment[]
): void {
    clearGroup(state.drawnWallsGroup);
    addWallSegments(state.drawnWallsGroup, walls, state.floorSize, {
        color: WALL_COLOR,
        height: wallHeight()
    });
}

function isValidPlan(plan: FloorPlanRef | null): plan is FloorPlanRef {
    return (
        plan !== null &&
        typeof plan.url === 'string' &&
        plan.url.length > 0 &&
        plan.widthPx > 0 &&
        plan.heightPx > 0
    );
}

function applyFloorTexture(
    state: InternalState,
    seq: number,
    tex: Texture,
    w: number,
    h: number
): void {
    if (state.disposed || seq !== state.floorLoadSeq) {
        tex.dispose();
        return;
    }
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    const geom = new PlaneGeometry(w, h);
    geom.rotateX(-Math.PI / 2);
    const mat = new MeshStandardMaterial({
        map: tex,
        roughness: FLOOR_ROUGHNESS,
        metalness: FLOOR_METALNESS
    });
    const mesh = new Mesh(geom, mat);
    mesh.position.y = FLOOR_Y_OFFSET; // avoid z-fight with walls
    state.floorGroup.add(mesh);
}

// ───── ZONE VOLUMES ──────────────────────────────────────────────────

function updateZoneVolumes(state: InternalState, zones: ZoneShape[]): void {
    clearGroup(state.zoneVolumesGroup);
    for (const zone of zones) addWallForZone(state, zone);
}

function addWallForZone(state: InternalState, zone: ZoneShape): void {
    if (zone.points.length < 3) return;
    const geom = buildZoneGeometry(zone, state.floorSize);
    if (!geom) return;
    const color = zone.color
        ? new Color(zone.color)
        : state.palette.defaultZone;
    const mat = new MeshLambertMaterial({
        color,
        transparent: true,
        opacity: FLOORPLAN_3D_WALL_OPACITY,
        side: DoubleSide,
        depthWrite: false
    });
    state.zoneVolumesGroup.add(new Mesh(geom, mat));
}

// ───── DRAFT PREVIEW ─────────────────────────────────────────────────

// What the user is drawing right now. Rendered through the same segment
// extruder as a finished wall, so the preview is literally a preview —
// what you see mid-draw is what a commit produces.
function updateDraft(state: InternalState, draft: DrawDraft | null): void {
    clearGroup(state.draftGroup);
    state.draftActive = draft !== null;
    if (!draft) return;
    addWallSegments(state.draftGroup, draftSegments(draft), state.floorSize, {
        color: DRAFT_COLOR,
        height: FLOORPLAN_3D_WALL_HEIGHT * DRAFT_WALL_HEIGHT_MULT,
        opacity: DRAFT_OPACITY
    });
    // Markers, not just segments: the first click produces no segment at
    // all, and a draft that renders as nothing reads as a broken tool.
    addDraftVertexMarkers(state, draft.points);
}

const DRAFT_COLOR = 0x4495d1;

function addDraftVertexMarkers(
    state: InternalState,
    points: readonly PlanPoint[]
): void {
    if (points.length === 0) return;
    const mat = new MeshStandardMaterial({
        color: DRAFT_COLOR,
        emissive: new Color(DRAFT_COLOR),
        emissiveIntensity: 0.6,
        roughness: 0.4,
        metalness: 0
    });
    const size = DRAFT_VERTEX_SIZE;
    for (const point of points) {
        const world = normalizedToWorld(point, state.floorSize);
        const mesh = new Mesh(new BoxGeometry(size, size, size), mat);
        mesh.position.set(world.x, size / 2, world.z);
        state.draftGroup.add(mesh);
    }
}

function buildZoneGeometry(
    zone: ZoneShape,
    size: FloorSize | null
): ExtrudeGeometry | null {
    // earcut throws on self-intersecting polygons — skip rather than crash.
    try {
        const shape = new Shape();
        const pts = zone.points.map((pt) => normalizedToWorld(pt, size));
        shape.moveTo(pts[0].x, pts[0].z);
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].z);
        shape.closePath();
        const geom = new ExtrudeGeometry(shape, {
            depth: FLOORPLAN_3D_WALL_HEIGHT,
            bevelEnabled: false
        });
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, FLOORPLAN_3D_WALL_HEIGHT, 0);
        return geom;
    } catch (err) {
        console.warn('[floor-plan-3d] invalid zone polygon', zone.id, err);
        return null;
    }
}

// ───── DEVICES ───────────────────────────────────────────────────────

interface KindBatch {
    fixture: ReturnType<typeof getFixture> & object;
    items: Array<{dev: FloorPlanDevice; pos: {x: number; z: number}}>;
}

function updateDevices(
    state: InternalState,
    devices: FloorPlanDevice[],
    placements: DevicePlacementMap
): void {
    clearGroup(state.devicesGroup);
    state.fixtureAnims.clear();
    state.placementIds.clear();
    for (const dev of devices) {
        state.placementIds.set(dev.id, floorPlanPlacementId(dev));
    }

    // Group by kind — high-count kinds collapse to InstancedMesh below.
    const byKind = new Map<string, KindBatch>();
    const generic: Array<{
        dev: FloorPlanDevice;
        pos: {x: number; z: number};
        ghost: boolean;
    }> = [];

    for (const dev of devices) {
        const p = placements[floorPlanPlacementId(dev)];
        if (!p) continue;
        const pos = normalizedToWorld(p, state.floorSize);
        const fixture = getFixture(p.fixture);
        // Auto-placed pins have no fixture (the picker is manual-only), so
        // they always flow through `generic` and never enter the instanced
        // path — safe to skip a per-instance ghost flag in the batch.
        if (!fixture) {
            generic.push({dev, pos, ghost: isAutoPlaced(p)});
            continue;
        }
        const existing = byKind.get(fixture.kind);
        if (existing) existing.items.push({dev, pos});
        else byKind.set(fixture.kind, {fixture, items: [{dev, pos}]});
    }

    for (const batch of byKind.values()) {
        if (batch.items.length >= FLOORPLAN_3D_INSTANCE_THRESHOLD) {
            renderKindInstanced(state, batch);
        } else {
            for (const {dev, pos} of batch.items) {
                const mesh = positionedFixture(dev, pos, batch.fixture);
                state.devicesGroup.add(mesh);
                state.fixtureAnims.set(dev.id, buildAnim(mesh));
            }
        }
    }

    for (const {dev, pos, ghost} of generic) {
        const pin = positionedPin(dev, pos);
        if (ghost) ghostObject(pin);
        state.devicesGroup.add(pin);
        state.fixtureAnims.set(dev.id, buildAnim(pin));
    }

    // Labels stay per-device — sprites are cheap and always tappable.
    for (const dev of devices) {
        const p = placements[floorPlanPlacementId(dev)];
        if (!p) continue;
        const pos = normalizedToWorld(p, state.floorSize);
        const label = positionedLabel(dev, pos, state.palette);
        if (isAutoPlaced(p)) ghostObject(label);
        state.devicesGroup.add(label);
    }
}

const AUTO_PIN_OPACITY = 0.45;

// Lowers opacity on every renderable descendant. Clones materials so the
// ghost styling never leaks back to manually-placed pins that happen to
// share a material instance.
function ghostObject(root: Object3D): void {
    root.traverse((node) => {
        if (node instanceof Mesh) node.material = ghostMaterial(node.material);
        else if (node instanceof Sprite)
            node.material = ghostSpriteMaterial(node.material);
    });
}

function ghostMaterial(mat: Material | Material[]): Material | Material[] {
    if (Array.isArray(mat)) return mat.map(cloneGhostMaterial);
    return cloneGhostMaterial(mat);
}

function cloneGhostMaterial(mat: Material): Material {
    const clone = mat.clone();
    clone.transparent = true;
    clone.opacity = AUTO_PIN_OPACITY;
    return clone;
}

function ghostSpriteMaterial(mat: SpriteMaterial): SpriteMaterial {
    const clone = mat.clone();
    clone.transparent = true;
    clone.opacity = AUTO_PIN_OPACITY;
    return clone;
}

// One InstancedMesh per sub-mesh in the kind's template — trades
// per-instance hover/click polish for one draw call per sub-mesh.
function renderKindInstanced(state: InternalState, batch: KindBatch): void {
    const {fixture, items} = batch;
    const count = items.length;

    const template = buildFixtureMesh(fixture.kind, 0xcccccc);
    template.updateMatrixWorld(true);

    const subMeshes: Array<{
        geometry: BufferGeometry;
        material: Material | Material[];
        localMatrix: Matrix4;
    }> = [];
    template.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        subMeshes.push({
            geometry: child.geometry,
            material: child.material,
            localMatrix: child.matrixWorld.clone()
        });
    });
    if (subMeshes.length === 0) return;

    const deviceIds = items.map((it) => it.dev.id);
    const compose = new Matrix4();
    const root = new Matrix4();

    for (const sub of subMeshes) {
        const inst = new InstancedMesh(sub.geometry, sub.material, count);
        inst.userData.deviceIds = deviceIds;
        inst.userData.kind = fixture.kind;
        for (let i = 0; i < count; i++) {
            const {pos} = items[i];
            root.makeTranslation(pos.x, fixture.mountY, pos.z);
            compose.multiplyMatrices(root, sub.localMatrix);
            inst.setMatrixAt(i, compose);
        }
        inst.instanceMatrix.needsUpdate = true;
        // Source geometry bounding sphere doesn't span instance extents.
        inst.frustumCulled = false;
        state.devicesGroup.add(inst);
    }
}

// Walk the fixture root and collect its indicator sub-meshes (tagged
// userData.indicator by the registry) with their post-state-binding
// baseline values. The per-frame stepper layers hover + flash boosts
// onto these baselines.
function buildAnim(group: Object3D): FixtureAnim {
    const baseEmissive = new Map<Mesh, number>();
    group.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        if (!child.userData.indicator) return;
        const mat = child.material;
        if (Array.isArray(mat) || !(mat instanceof MeshStandardMaterial))
            return;
        baseEmissive.set(child, mat.emissiveIntensity);
    });
    return {group, hover: 0, baseEmissive};
}

function positionedFixture(
    dev: FloorPlanDevice,
    pos: {x: number; z: number},
    fixture: ReturnType<typeof getFixture> & object
): Object3D {
    const obj = buildFixtureMesh(fixture.kind, dev.color);
    obj.position.set(pos.x, fixture.mountY, pos.z);
    // Tag every descendant with the device id so raycaster hits register
    // regardless of which sub-mesh the user actually clicked.
    obj.traverse((child) => {
        child.userData.deviceId = dev.id;
    });
    applyFixtureState(obj, dev);
    return obj;
}

// Apply online + level state to fixture indicator sub-meshes. The
// registry tags indicators with userData.indicator = true (both for
// primitives via emissive!==black and for GLBs via name-regex match).
function applyFixtureState(root: Object3D, dev: FloorPlanDevice): void {
    const online = dev.online ?? true;
    const level = dev.level ?? 1;
    // Off = no emissive; online + level scales from idle baseline (0.20)
    // up to full brightness (0.85).
    const target = online ? 0.2 + level * 0.65 : 0;
    root.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        if (!child.userData.indicator) return;
        const mat = child.material;
        if (Array.isArray(mat) || !(mat instanceof MeshStandardMaterial))
            return;
        mat.emissiveIntensity = target;
    });
}

function positionedPin(
    dev: FloorPlanDevice,
    pos: {x: number; z: number}
): Mesh {
    const pin = makePin(dev.color);
    pin.position.set(pos.x, FLOORPLAN_3D_PIN_HEIGHT / 2, pos.z);
    pin.userData.deviceId = dev.id;
    return pin;
}

function positionedLabel(
    dev: FloorPlanDevice,
    pos: {x: number; z: number},
    palette: BrandPalette
): Sprite {
    const label = makeLabelBillboard(dev.label, palette);
    label.position.set(
        pos.x,
        FLOORPLAN_3D_PIN_HEIGHT + FLOORPLAN_3D_LABEL_OFFSET_Y,
        pos.z
    );
    label.userData.deviceId = dev.id;
    return label;
}

function makePin(color: number): Mesh {
    const geom = new BoxGeometry(
        FLOORPLAN_3D_PIN_RADIUS * 2,
        FLOORPLAN_3D_PIN_HEIGHT,
        FLOORPLAN_3D_PIN_RADIUS * 2
    );
    const mat = new MeshStandardMaterial({
        color: new Color(color),
        roughness: PIN_ROUGHNESS,
        metalness: PIN_METALNESS,
        emissive: new Color(color),
        emissiveIntensity: PIN_EMISSIVE_INTENSITY
    });
    return new Mesh(geom, mat);
}

function makeLabelBillboard(label: string, palette: BrandPalette): Sprite {
    const canvas = paintLabelCanvas(label, palette);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const mat = new SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: false
    });
    const sprite = new Sprite(mat);
    sprite.scale.set(...LABEL_SPRITE_SCALE);
    return sprite;
}

function paintLabelCanvas(
    label: string,
    palette: BrandPalette
): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = LABEL_CANVAS_W;
    canvas.height = LABEL_CANVAS_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.fillStyle = palette.labelBg;
    ctx.globalAlpha = FLOORPLAN_3D_LABEL_OPACITY;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.labelText;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    return canvas;
}

// ───── INPUT ─────────────────────────────────────────────────────────

function handlePointerDown(state: InternalState, e: PointerEvent): void {
    if (!state.host || state.disposed) return;
    recordInput(state);
    // A live draft owns the canvas: dragging a device mid-draw would place
    // a vertex and move a pin from one gesture.
    if (state.editMode && !state.draftActive) {
        const id = pickDeviceAt(state, e.clientX, e.clientY);
        if (id) {
            startDeviceDrag(state, id);
            return;
        }
    }
    if (!state.clickHandler && !state.draftActive) return;
    listenForClickRelease(state, e.clientX, e.clientY);
}

// Click is the default gesture: defer the clickHandler call to pointerup
// and only emit when the pointer hasn't moved past the click threshold.
function listenForClickRelease(
    state: InternalState,
    startX: number,
    startY: number
): void {
    const gesture = new AbortController();
    bindGestureToSceneAbort(state, gesture);
    window.addEventListener(
        'pointerup',
        (up) => {
            onPointerUp(state, up, startX, startY);
            gesture.abort();
        },
        {signal: gesture.signal, once: true}
    );
    window.addEventListener('pointercancel', () => gesture.abort(), {
        signal: gesture.signal,
        once: true
    });
}

// Drag session — moves the device's mesh on each pointermove, then emits
// the final normalized position on pointerup. Orbit is suspended for the
// gesture only; every exit path (drop, cancel, scene dispose) funnels
// through `gesture.abort()`, so one listener restores it.
function startDeviceDrag(state: InternalState, deviceId: string): void {
    const gesture = new AbortController();
    bindGestureToSceneAbort(state, gesture);
    state.controls.enabled = false;
    gesture.signal.addEventListener(
        'abort',
        () => {
            state.controls.enabled = true;
        },
        {once: true}
    );
    window.addEventListener(
        'pointermove',
        (e) => onDragMove(state, deviceId, e),
        {signal: gesture.signal}
    );
    window.addEventListener(
        'pointerup',
        (e) => onDragEnd(state, deviceId, e, gesture),
        {signal: gesture.signal, once: true}
    );
    window.addEventListener('pointercancel', () => gesture.abort(), {
        signal: gesture.signal,
        once: true
    });
}

// Cancels the gesture when the scene is disposed. `signal: gesture.signal`
// auto-removes this listener when the gesture itself ends — without it,
// every pointerdown leaked one abort-listener for the lifetime of the tab.
function bindGestureToSceneAbort(
    state: InternalState,
    gesture: AbortController
): void {
    state.pointerAbort.signal.addEventListener('abort', () => gesture.abort(), {
        once: true,
        signal: gesture.signal
    });
}

function onDragMove(
    state: InternalState,
    deviceId: string,
    e: PointerEvent
): void {
    const world = pickFloorPointAt(state, e.clientX, e.clientY);
    if (!world) return;
    moveDeviceMesh(state, deviceId, world);
    markNeedsRender(state);
}

function onDragEnd(
    state: InternalState,
    deviceId: string,
    e: PointerEvent,
    gesture: AbortController
): void {
    gesture.abort();
    if (!state.moveHandler) return;
    const norm = normalizedPointAt(state, e.clientX, e.clientY);
    if (!norm) return;
    const placementId = state.placementIds.get(deviceId) ?? deviceId;
    state.moveHandler(placementId, norm);
}

// Screen point → the 0..1 floor coords stored in devicePlacements.
function normalizedPointAt(
    state: InternalState,
    clientX: number,
    clientY: number
): {x: number; y: number} | null {
    if (!state.floorSize) return null;
    const world = pickFloorPointAt(state, clientX, clientY);
    if (!world) return null;
    return worldToNormalizedXY(world, state.floorSize);
}

const FLOOR_PLANE = new Plane(new Vector3(0, 1, 0), 0);

// Ray-cast the cursor onto the y=0 floor plane → world (x, z).
function pickFloorPointAt(
    state: InternalState,
    clientX: number,
    clientY: number
): {x: number; z: number} | null {
    if (!state.host) return null;
    const rect = state.host.getBoundingClientRect();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hit = new Vector3();
    return state.raycaster.ray.intersectPlane(FLOOR_PLANE, hit)
        ? {x: hit.x, z: hit.z}
        : null;
}

// Slides every devicesGroup child belonging to the device on XZ (pin + label
// are added as sibling top-level children, so both must move). Y stays put
// so each child keeps its own lift off the floor.
function moveDeviceMesh(
    state: InternalState,
    deviceId: string,
    world: {x: number; z: number}
): void {
    for (const child of state.devicesGroup.children) {
        if (!matchesDeviceId(child, deviceId)) continue;
        child.position.x = world.x;
        child.position.z = world.z;
    }
}

function matchesDeviceId(obj: Object3D, deviceId: string): boolean {
    if (obj.userData?.deviceId === deviceId) return true;
    let found = false;
    obj.traverse((node) => {
        if (node.userData?.deviceId === deviceId) found = true;
    });
    return found;
}

function onPointerUp(
    state: InternalState,
    up: PointerEvent,
    startX: number,
    startY: number
): void {
    if (state.disposed) return;
    const dx = up.clientX - startX;
    const dy = up.clientY - startY;
    if (Math.hypot(dx, dy) > FLOORPLAN_3D_CLICK_THRESHOLD_PX) return;
    emitClickAt(state, up);
}

function emitClickAt(state: InternalState, e: PointerEvent): void {
    if (!state.host) return;
    // Drawing wins over picking. Same normalized contract the 2D canvas
    // emits, so one draw pipeline serves both renderers (D-032).
    if (state.draftActive) {
        const point = normalizedPointAt(state, e.clientX, e.clientY);
        if (point) state.vertexHandler?.(point);
        return;
    }
    const deviceId = pickDeviceAt(state, e.clientX, e.clientY);
    if (!deviceId) return;
    const now = performance.now();
    const lastClick = state.lastClickTime.get(deviceId) ?? -Infinity;
    state.lastClickTime.set(deviceId, now);

    if (now - lastClick <= FLOORPLAN_3D_DBLCLICK_MS) {
        flyCameraToDevice(state, deviceId);
        state.lastClickTime.delete(deviceId);
        return;
    }
    state.clickFlashes.set(deviceId, now);
    markNeedsRender(state);
    state.clickHandler?.(deviceId);
}

function pickDeviceAt(
    state: InternalState,
    clientX: number,
    clientY: number
): string | null {
    if (!state.host) return null;
    const rect = state.host.getBoundingClientRect();
    state.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hits = state.raycaster.intersectObjects(
        state.devicesGroup.children,
        true
    );
    for (const hit of hits) {
        // InstancedMesh hit — look up device by instanceId.
        if (
            hit.object instanceof InstancedMesh &&
            typeof hit.instanceId === 'number'
        ) {
            const ids = hit.object.userData?.deviceIds;
            if (Array.isArray(ids)) {
                const id = ids[hit.instanceId];
                if (typeof id === 'string') return id;
            }
        }
        const id = hit.object.userData?.deviceId;
        if (typeof id === 'string') return id;
    }
    return null;
}

function handlePointerMove(state: InternalState, e: PointerEvent): void {
    if (state.disposed) return;
    recordInput(state);
    // While drawing, every point on the floor is a target — hover
    // highlighting a device would suggest the click does something else.
    if (state.draftActive) {
        if (state.host) state.host.style.cursor = 'crosshair';
        if (state.hoveredDeviceId !== null) {
            state.hoveredDeviceId = null;
            markNeedsRender(state);
        }
        return;
    }
    const id = pickDeviceAt(state, e.clientX, e.clientY);
    if (id === state.hoveredDeviceId) return;
    state.hoveredDeviceId = id;
    if (state.host) {
        state.host.style.cursor = id ? 'pointer' : 'default';
    }
    markNeedsRender(state);
}

function flyCameraToDevice(state: InternalState, deviceId: string): void {
    const anim = state.fixtureAnims.get(deviceId);
    if (!anim) return;
    const target = anim.group.position.clone();
    // Camera offset — hover above and behind the target at ~40% distance.
    const offset = new Vector3(
        0,
        FLOORPLAN_3D_CAMERA_HEIGHT * 0.4,
        FLOORPLAN_3D_CAMERA_DIST * 0.4
    );
    state.activeTween = {
        fromPos: state.camera.position.clone(),
        toPos: target.clone().add(offset),
        fromTarget: state.controls.target.clone(),
        toTarget: target,
        startTime: performance.now(),
        durationMs: FLOORPLAN_3D_FLYTO_MS
    };
    markNeedsRender(state);
}

// ───── HELPERS ───────────────────────────────────────────────────────

// Thin wrapper around the shared math — supplies the 3D scene's square
// fallback constant so call sites stay terse.
function normalizedToWorld(
    p: {x: number; y: number},
    size: FloorSize | null
): {x: number; z: number} {
    return normalizedToWorldXZ(p, size, FLOORPLAN_3D_PLAN_SIZE);
}

function clearGroup(group: Group): void {
    while (group.children.length > 0) {
        const child = group.children[0];
        group.remove(child);
        disposeObjectTree(child);
    }
}

// Recursive — fixture Groups contain multiple sub-meshes; each needs
// its own geometry + material disposed.
function disposeObjectTree(root: Object3D): void {
    root.traverse(disposeObject);
}

function disposeObject(child: Object3D): void {
    // Shared geometry + material owned by the kind template; only the
    // per-instance matrix buffer is released here.
    if (child instanceof InstancedMesh) {
        child.dispose();
        return;
    }
    if (child instanceof Mesh) {
        child.geometry?.dispose();
        disposeMaterial(child.material);
        return;
    }
    if (child instanceof Sprite) disposeMaterial(child.material);
}

// Material.dispose() does NOT recurse into textures; walk them first.
function disposeMaterial(mat: unknown): void {
    if (!mat) return;
    if (Array.isArray(mat)) {
        for (const m of mat) disposeSingleMaterial(m);
        return;
    }
    disposeSingleMaterial(mat);
}

function disposeSingleMaterial(mat: unknown): void {
    if (!isDisposableObject(mat)) return;
    for (const key of MATERIAL_TEXTURE_KEYS) {
        const tex = mat[key];
        if (tex instanceof Texture) tex.dispose();
    }
    if (typeof mat.dispose === 'function') mat.dispose();
}

function isDisposableObject(
    value: unknown
): value is Record<string, unknown> & {dispose?: () => void} {
    return value !== null && typeof value === 'object';
}
