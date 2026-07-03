import {Application, Assets, Container, Graphics, Sprite, Text} from 'pixi.js';
import {Viewport} from 'pixi-viewport';
import type {Ref} from 'vue';
import {onBeforeUnmount, onMounted, ref, shallowRef, watch} from 'vue';
import {isAutoPlaced} from '@/helpers/auto-placement';
import {stripInkscapeBaseLayer} from '@/helpers/svg-floorplan';
import {hasWebGL} from '@/helpers/webgl';
import {debug} from '@/tools/debug';
import type {
    DevicePlacementMap,
    FloorPlanRef,
    ZoneShape
} from '@/types/floor-plan';

const AUTO_PIN_ALPHA = 0.45;

// PixiJS floor-plan stage. Diff-based sprite sync, loadGen guards
// against stale Assets.load resolutions, cancelled flag protects
// unmount-during-async-init from leaking a WebGL context.

export interface DeviceSprite {
    id: string;
    label: string;
    color: number;
}

// Zone draft = in-progress polygon being placed via canvas clicks.
// Treated separately from the persisted `zones` so finished zones can
// be diff-rendered while the draft repaints on every vertex add.
export interface ZoneDraft {
    points: Array<{x: number; y: number}>;
    color?: string;
}

export interface FloorPlanStageOptions {
    plan: Ref<FloorPlanRef | null>;
    zones: Ref<ZoneShape[]>;
    placements: Ref<DevicePlacementMap>;
    devices: Ref<DeviceSprite[]>;
    onDeviceMove?: (id: string, position: {x: number; y: number}) => void;
    onDeviceClick?: (id: string) => void;
    editMode?: Ref<boolean>;
    drawingZone?: Ref<ZoneDraft | null>;
    onZoneVertex?: (x: number, y: number) => void;
    /** Per-layer visibility — same names as the 3D scene API. */
    layerVisibility?: Ref<{floor: boolean; walls: boolean; devices: boolean}>;
}

interface SpriteEntry {
    node: Container;
    label: string;
    color: number;
    // Bound only when editMode === true.
    drag: DragHandle | null;
}

interface DragHandle {
    detach: () => void;
}

interface ZoneEntry {
    shape: Graphics;
    label: Text;
    sig: string;
}

// Plan dimensions are part of the signature so re-uploading at a
// different size forces a re-render at the new pixel multiplier.
function zoneSignature(
    z: ZoneShape,
    widthPx: number,
    heightPx: number
): string {
    const pts = z.points
        .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)
        .join(';');
    return `${widthPx}x${heightPx}|${z.name}|${z.color}|${pts}`;
}

export function useFloorPlanStage(
    host: Ref<HTMLElement | null>,
    opts: FloorPlanStageOptions
) {
    const app = shallowRef<Application | null>(null);
    const viewport = shallowRef<Viewport | null>(null);
    const ready = ref(false);
    const unsupported = ref(false);
    const planLayer = new Container();
    const zoneLayer = new Container();
    const drawingLayer = new Container();
    const deviceLayer = new Container();
    const sprites = new Map<string, SpriteEntry>();
    const zones = new Map<string, ZoneEntry>();
    let loadGen = 0;
    let lastLoadedUrl: string | null = null;
    let cancelled = false;
    let detachVertexCapture: (() => void) | null = null;
    let hostResizeObserver: ResizeObserver | null = null;

    async function init() {
        if (!host.value) return;
        if (!hasWebGL()) {
            unsupported.value = true;
            return;
        }
        const application = new Application();
        try {
            await application.init({
                resizeTo: host.value,
                antialias: true,
                backgroundAlpha: 0,
                preference: 'webgl',
                resolution: Math.min(window.devicePixelRatio, 2),
                autoDensity: true
            });
        } catch {
            unsupported.value = true;
            return;
        }
        if (cancelled) {
            application.destroy(true);
            return;
        }
        // Pixi's canvas is appended at runtime so it doesn't pick up Vue's
        // scoped style attribute. Apply the layout rules inline here instead
        // of relying on a `:deep(canvas)` selector in the host component.
        application.canvas.style.display = 'block';
        application.canvas.style.width = '100%';
        application.canvas.style.height = '100%';
        host.value.appendChild(application.canvas);

        // World dims placeholder; applyPlan() resizes to match the plan
        // once it loads. Without that, fit/clamp computations use the
        // wrong world size and the plan ends up tiny on screen.
        const planInit = opts.plan.value;
        const vp = new Viewport({
            screenWidth: host.value.clientWidth,
            screenHeight: host.value.clientHeight,
            worldWidth: planInit?.widthPx ?? host.value.clientWidth,
            worldHeight: planInit?.heightPx ?? host.value.clientHeight,
            events: application.renderer.events
        } as ConstructorParameters<typeof Viewport>[0]);
        vp.drag()
            .pinch()
            .wheel()
            .decelerate()
            .clampZoom({minScale: 0.2, maxScale: 8});
        application.stage.addChild(vp as unknown as Container);
        vp.addChild(planLayer as unknown as never);
        vp.addChild(zoneLayer as unknown as never);
        vp.addChild(drawingLayer as unknown as never);
        vp.addChild(deviceLayer as unknown as never);

        app.value = application;
        viewport.value = vp;
        ready.value = true;

        watchHostResize();

        await applyPlan();
        if (cancelled) return;
        applyZones();
        syncDevices();
        applyDrawingZone();
        bindVertexCapture();
    }

    async function applyPlan() {
        const p = opts.plan.value;
        if (!p) {
            planLayer.removeChildren();
            lastLoadedUrl = null;
            debug('[FloorPlanStage] plan cleared');
            return;
        }
        // Same URL: skip the network/decode but still re-apply dimensions
        // and viewport bounds in case widthPx/heightPx changed.
        if (p.url === lastLoadedUrl) {
            const first = planLayer.children[0];
            const sprite = first instanceof Sprite ? first : null;
            if (sprite) {
                sprite.width = p.widthPx;
                sprite.height = p.heightPx;
                const vp = viewport.value;
                if (vp) {
                    vp.resize(
                        host.value?.clientWidth ?? p.widthPx,
                        host.value?.clientHeight ?? p.heightPx,
                        p.widthPx,
                        p.heightPx
                    );
                }
            }
            debug('[FloorPlanStage] plan dims re-applied (same URL)', {
                url: p.url,
                widthPx: p.widthPx,
                heightPx: p.heightPx
            });
            return;
        }

        const gen = ++loadGen;
        planLayer.removeChildren();
        // Invalidate the URL cache while no sprite is mounted. If the
        // load below fails, future calls with the same URL won't hit
        // the empty-skip path that would leave the canvas blank.
        lastLoadedUrl = null;
        debug('[FloorPlanStage] plan load', {url: p.url, gen});
        try {
            const loadUrl = await resolveLoadUrl(p.url);
            if (gen !== loadGen || cancelled) {
                if (loadUrl !== p.url) URL.revokeObjectURL(loadUrl);
                return;
            }
            const texture = await Assets.load(loadUrl);
            // Blob URL was decoded into a GPU texture; safe to revoke.
            if (loadUrl !== p.url) URL.revokeObjectURL(loadUrl);
            if (gen !== loadGen || cancelled) {
                debug('[FloorPlanStage] plan load stale', {
                    url: p.url,
                    gen,
                    current: loadGen
                });
                return;
            }
            const sprite = new Sprite(texture);
            sprite.width = p.widthPx;
            sprite.height = p.heightPx;
            planLayer.addChild(sprite);
            lastLoadedUrl = p.url;
            const vp = viewport.value;
            if (vp) {
                vp.resize(
                    host.value?.clientWidth ?? p.widthPx,
                    host.value?.clientHeight ?? p.heightPx,
                    p.widthPx,
                    p.heightPx
                );
                vp.fit(true, p.widthPx, p.heightPx);
                vp.moveCenter(p.widthPx / 2, p.heightPx / 2);
            }
        } catch (err) {
            if (gen !== loadGen || cancelled) return;
            console.warn('[FloorPlanStage] plan load failed', {
                url: p.url,
                err
            });
        }
    }

    function applyZones() {
        const p = opts.plan.value;
        if (!p) {
            for (const e of zones.values()) detachZone(e);
            zones.clear();
            return;
        }
        const seen = new Set<string>();
        for (const zone of opts.zones.value) {
            if (zone.points.length < 3) continue;
            seen.add(zone.id);
            const sig = zoneSignature(zone, p.widthPx, p.heightPx);
            const existing = zones.get(zone.id);
            if (existing && existing.sig === sig) continue;
            if (existing) detachZone(existing);

            const pts = zone.points.map((pt) => ({
                x: pt.x * p.widthPx,
                y: pt.y * p.heightPx
            }));
            const color = parseColor(zone.color);
            const shape = new Graphics();
            shape.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++)
                shape.lineTo(pts[i].x, pts[i].y);
            shape.closePath();
            shape.fill({color, alpha: 0.18});
            shape.stroke({color, width: 2, alpha: 0.7});
            zoneLayer.addChild(shape);

            const centroid = polygonCentroid(pts);
            const label = new Text({
                text: zone.name,
                style: {fill: 0xeaf4ff, fontSize: 12, fontWeight: '600'}
            });
            label.anchor.set(0.5);
            label.position.set(centroid.x, centroid.y);
            zoneLayer.addChild(label);

            zones.set(zone.id, {shape, label, sig});
        }
        for (const [id, entry] of zones) {
            if (seen.has(id)) continue;
            detachZone(entry);
            zones.delete(id);
        }
    }

    function detachZone(entry: ZoneEntry) {
        zoneLayer.removeChild(entry.shape);
        zoneLayer.removeChild(entry.label);
        entry.shape.destroy();
        entry.label.destroy();
    }

    // Diff sync: existing sprites are updated in place; new ones created;
    // unplaced/removed devices are detached and disposed.
    function syncDevices() {
        const p = opts.plan.value;
        if (!p) {
            for (const entry of sprites.values()) detachSprite(entry);
            sprites.clear();
            return;
        }
        const placements = opts.placements.value;
        const editing = opts.editMode?.value ?? false;
        const seen = new Set<string>();

        for (const device of opts.devices.value) {
            const pos = placements[device.id];
            if (!pos) continue;
            seen.add(device.id);

            let entry = sprites.get(device.id);
            if (!entry) {
                const node = makeDeviceSprite(device.label, device.color);
                deviceLayer.addChild(node);
                entry = {
                    node,
                    label: device.label,
                    color: device.color,
                    drag: null
                };
                sprites.set(device.id, entry);
                if (opts.onDeviceClick) {
                    // While a zone draft is active, viewport `clicked` is
                    // already adding a vertex at this point — emitting
                    // deviceClick here too would also navigate away from
                    // the location detail page mid-draft.
                    node.on('pointertap', () => {
                        if (opts.drawingZone?.value) return;
                        opts.onDeviceClick?.(device.id);
                    });
                }
            } else if (
                entry.label !== device.label ||
                entry.color !== device.color
            ) {
                refreshDeviceSprite(entry.node, {
                    label: device.label,
                    color: device.color
                });
                entry.label = device.label;
                entry.color = device.color;
            }

            entry.node.position.set(pos.x * p.widthPx, pos.y * p.heightPx);
            entry.node.cursor = editing ? 'grab' : 'pointer';
            entry.node.eventMode = 'static';
            // Ghost auto-placed pins so users see at a glance which are
            // suggestions vs their own placements. Manual drags lift the flag.
            entry.node.alpha = isAutoPlaced(pos) ? AUTO_PIN_ALPHA : 1;

            // Drag binding follows edit mode toggles.
            if (editing && !entry.drag && opts.onDeviceMove) {
                // Read plan dimensions at drop-time, not bind-time —
                // a mid-edit dimension change otherwise denormalizes
                // the drop against the wrong scale.
                entry.drag = bindDrag(entry.node, viewport.value, (wx, wy) => {
                    const cp = opts.plan.value;
                    if (!cp) return;
                    opts.onDeviceMove?.(device.id, {
                        x: wx / cp.widthPx,
                        y: wy / cp.heightPx
                    });
                });
            } else if (!editing && entry.drag) {
                entry.drag.detach();
                entry.drag = null;
            }
        }

        for (const [id, entry] of sprites) {
            if (seen.has(id)) continue;
            detachSprite(entry);
            sprites.delete(id);
        }
    }

    function detachSprite(entry: SpriteEntry) {
        entry.drag?.detach();
        entry.node.removeAllListeners();
        deviceLayer.removeChild(entry.node);
        entry.node.destroy({children: true});
    }

    // applyPlan is async; chain applyZones after it so zones repaint
    // at the new pixel multiplier when the plan resolution changes.
    watch(opts.plan, async () => {
        await applyPlan();
        if (cancelled) return;
        applyZones();
        syncDevices();
        applyDrawingZone();
    });
    watch(opts.zones, applyZones, {deep: true});
    if (opts.layerVisibility) {
        watch(
            opts.layerVisibility,
            (v) => {
                planLayer.visible = v.floor;
                zoneLayer.visible = v.walls;
                deviceLayer.visible = v.devices;
            },
            {deep: true, immediate: true}
        );
    }
    watch(
        () => [opts.placements.value, opts.devices.value, opts.editMode?.value],
        syncDevices,
        {deep: true}
    );
    if (opts.drawingZone) {
        watch(opts.drawingZone, applyDrawingZone, {deep: true});
        watch(() => opts.drawingZone?.value !== null, bindVertexCapture);
    }

    // Re-render the in-progress polygon. The draft is open (no fill yet) —
    // a polyline + per-vertex dots so the user can see what they've placed.
    function applyDrawingZone() {
        drawingLayer.removeChildren();
        const p = opts.plan.value;
        const draft = opts.drawingZone?.value;
        if (!p || !draft || draft.points.length === 0) return;
        const pts = draft.points.map((pt) => ({
            x: pt.x * p.widthPx,
            y: pt.y * p.heightPx
        }));
        const color = parseColor(draft.color ?? '#5b8def');
        if (pts.length >= 2) {
            const line = new Graphics();
            line.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                line.lineTo(pts[i].x, pts[i].y);
            }
            line.stroke({color, width: 2, alpha: 0.85});
            drawingLayer.addChild(line);
        }
        for (const pt of pts) {
            const dot = new Graphics()
                .circle(pt.x, pt.y, 4)
                .fill({color})
                .stroke({color: 0xffffff, width: 1, alpha: 0.85});
            drawingLayer.addChild(dot);
        }
    }

    // Subscribe / unsubscribe canvas clicks based on whether a draft is active.
    // pixi-viewport's `clicked` event hands us pre-resolved world coords so
    // we just divide by plan dimensions to get the normalized 0..1 point.
    // Reads plan dimensions at click time so a mid-draft re-upload doesn't
    // anchor verts against stale dimensions.
    function bindVertexCapture() {
        const vp = viewport.value;
        if (!vp) return;
        detachVertexCapture?.();
        detachVertexCapture = null;
        if (!opts.drawingZone?.value || !opts.onZoneVertex) return;
        const handler = (e: {world: {x: number; y: number}}) => {
            const cp = opts.plan.value;
            if (!cp) return;
            opts.onZoneVertex?.(
                e.world.x / cp.widthPx,
                e.world.y / cp.heightPx
            );
        };
        (vp as unknown as {on: (ev: string, f: typeof handler) => void}).on(
            'clicked',
            handler
        );
        detachVertexCapture = () => {
            (
                vp as unknown as {
                    off: (ev: string, f: typeof handler) => void;
                }
            ).off('clicked', handler);
        };
    }

    // Template refs are null during setup; defer init until host is mounted.
    onMounted(() => {
        void init();
    });

    onBeforeUnmount(() => {
        cancelled = true;
        detachVertexCapture?.();
        detachVertexCapture = null;
        hostResizeObserver?.disconnect();
        hostResizeObserver = null;
        for (const entry of sprites.values()) detachSprite(entry);
        sprites.clear();
        for (const entry of zones.values()) detachZone(entry);
        zones.clear();
        drawingLayer.removeChildren();
        app.value?.destroy(true, {children: true, texture: false});
        app.value = null;
        viewport.value = null;
        ready.value = false;
    });

    // Strip the Inkscape "Base" layer (full-bleed white rect) before Pixi
    // rasterizes the SVG. Non-SVG or fetch failure → fall back to the URL.
    async function resolveLoadUrl(url: string): Promise<string> {
        if (!isSvgUrl(url)) return url;
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

    function isSvgUrl(url: string): boolean {
        return /\.svg(\?|#|$)/i.test(url);
    }

    // Re-fit the plan whenever the host element resizes (fullscreen toggle,
    // window resize, drawer open/close). Without this the viewport stays at
    // the initial screen rect — the SVG renders at native pixels and never
    // grows when the container does.
    function watchHostResize(): void {
        const hostEl = host.value;
        if (!hostEl) return;
        if (typeof ResizeObserver === 'undefined') return;
        hostResizeObserver = new ResizeObserver(() => refitToHost());
        hostResizeObserver.observe(hostEl);
    }

    function refitToHost(): void {
        const vp = viewport.value;
        const hostEl = host.value;
        const plan = opts.plan.value;
        if (!vp || !hostEl) return;
        const screenW = hostEl.clientWidth;
        const screenH = hostEl.clientHeight;
        if (screenW === 0 || screenH === 0) return;
        const worldW = plan?.widthPx ?? screenW;
        const worldH = plan?.heightPx ?? screenH;
        vp.resize(screenW, screenH, worldW, worldH);
        if (plan) {
            vp.fit(true, worldW, worldH);
            vp.moveCenter(worldW / 2, worldH / 2);
        }
    }

    return {app, viewport, ready, unsupported};
}

/* ── helpers ── */

function parseColor(hex: string): number {
    return Number.parseInt(hex.replace('#', ''), 16) || 0x5b8def;
}

function polygonCentroid(points: Array<{x: number; y: number}>): {
    x: number;
    y: number;
} {
    let x = 0;
    let y = 0;
    for (const p of points) {
        x += p.x;
        y += p.y;
    }
    return {x: x / points.length, y: y / points.length};
}

function makeDeviceSprite(label: string, color: number): Container {
    const root = new Container();
    const glow = new Graphics().circle(0, 0, 18).fill({color, alpha: 0.18});
    const dot = new Graphics()
        .circle(0, 0, 9)
        .fill({color})
        .stroke({color: 0xffffff, width: 1.5, alpha: 0.85});
    const tag = new Text({
        text: label,
        style: {fill: 0xeaf4ff, fontSize: 10, fontWeight: '500'}
    });
    tag.anchor.set(0.5, 0);
    tag.position.set(0, 14);
    root.addChild(glow, dot, tag);
    return root;
}

function refreshDeviceSprite(
    node: Container,
    appearance: {label: string; color: number}
) {
    const [glow, dot, tag] = node.children as [Graphics, Graphics, Text];
    glow.clear().circle(0, 0, 18).fill({color: appearance.color, alpha: 0.18});
    dot.clear()
        .circle(0, 0, 9)
        .fill({color: appearance.color})
        .stroke({color: 0xffffff, width: 1.5, alpha: 0.85});
    tag.text = appearance.label;
}

function bindDrag(
    node: Container,
    vp: Viewport | null,
    onMove: (wx: number, wy: number) => void
): DragHandle {
    let dragging = false;
    let originalCursor: string | undefined;

    const down = (e: {stopPropagation: () => void}) => {
        dragging = true;
        originalCursor = node.cursor;
        node.cursor = 'grabbing';
        if (vp) vp.pause = true;
        e.stopPropagation();
    };
    const move = (e: {global: {x: number; y: number}}) => {
        if (!dragging || !vp) return;
        const w = vp.toWorld(e.global.x, e.global.y);
        node.position.set(w.x, w.y);
    };
    const up = () => {
        if (!dragging) return;
        dragging = false;
        if (vp) vp.pause = false;
        node.cursor = originalCursor ?? 'grab';
        onMove(node.position.x, node.position.y);
    };

    node.on('pointerdown', down);
    node.on('globalpointermove', move);
    node.on('pointerup', up);
    node.on('pointerupoutside', up);

    return {
        detach: () => {
            node.off('pointerdown', down);
            node.off('globalpointermove', move);
            node.off('pointerup', up);
            node.off('pointerupoutside', up);
        }
    };
}
