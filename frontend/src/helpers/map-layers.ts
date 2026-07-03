import type {Layer, PickingInfo} from '@deck.gl/core';
import {IconLayer, ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {
    PIN_ANCHOR_Y,
    PIN_SELECTED_SCALE,
    PIN_SPRITE_H,
    PIN_SPRITE_W,
    pinSpriteUrl
} from '@/helpers/map-pin-sprite';
import type {ClusterPoint} from '@/helpers/pinClustering';
import {statusRgba} from '@/helpers/status-colors';
import type {MapPin} from '@/types/map';

export interface PinAnimation {
    /** Monotonic ms since map mount — each halo derives its own cycle. */
    timeMs: number;
}

const ALERT_PERIOD_MS = 1200; // <3Hz WCAG cap.

const HALO_RADIUS_PX = 22;
const CLUSTER_OUTLINE_PX = 1.5;
const CLUSTER_RADIUS_MIN_PX = 18;
const CLUSTER_RADIUS_MAX_PX = 36;
const TEXT_LAYER_BASELINE = 'center' as const;

function readVarRgb(
    varName: string,
    fallback: [number, number, number]
): [number, number, number] {
    if (typeof document === 'undefined') return fallback;
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        ?.trim();
    if (!raw) return fallback;
    const parts = raw.split(',').map((p) => Number.parseInt(p.trim(), 10));
    if (parts.length !== 3 || parts.some(Number.isNaN)) return fallback;
    return [parts[0], parts[1], parts[2]];
}

function readVarNumber(varName: string, fallback: number): number {
    if (typeof document === 'undefined') return fallback;
    const raw = getComputedStyle(document.documentElement)
        .getPropertyValue(varName)
        ?.trim();
    if (!raw) return fallback;
    const n = Number.parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
}

function outlineRgba(): [number, number, number, number] {
    const [r, g, b] = readVarRgb('--map-pin-outline-rgb', [7, 15, 28]);
    const alpha = readVarNumber('--map-pin-outline-alpha', 0.9);
    return [r, g, b, Math.round(alpha * 255)];
}

function clusterFillRgba(): [number, number, number, number] {
    const [r, g, b] = readVarRgb('--color-primary-rgb', [68, 149, 209]);
    return [r, g, b, 230];
}

function clusterGlowRgba(): [number, number, number, number] {
    const [r, g, b] = readVarRgb('--color-primary-rgb', [68, 149, 209]);
    return [r, g, b, 80];
}

function childIconColors(): {fill: string; outline: string} {
    if (typeof document === 'undefined')
        return {fill: '#5b8def', outline: 'rgba(7,15,28,0.7)'};
    const root = getComputedStyle(document.documentElement);
    const fill = root.getPropertyValue('--map-pin-child')?.trim() || '#5b8def';
    const [r, g, b] = readVarRgb('--map-pin-outline-rgb', [7, 15, 28]);
    const alpha = readVarNumber('--map-pin-outline-alpha', 0.7);
    return {fill, outline: `rgba(${r},${g},${b},${alpha})`};
}

interface PinPartition {
    calm: MapPin[];
    alerting: MapPin[];
}

function colorFor(pin: MapPin): [number, number, number, number] {
    return statusRgba(pin.status ?? 'unknown');
}

function isAlerting(pin: MapPin): boolean {
    return (pin.alertCount ?? 0) > 0;
}

function partitionByAlerts(pins: readonly MapPin[]): PinPartition {
    const calm: MapPin[] = [];
    const alerting: MapPin[] = [];
    for (const pin of pins) (isAlerting(pin) ? alerting : calm).push(pin);
    return {calm, alerting};
}

// updateTrigger key — only rebuild GPU buffers on status/alert changes.
function pinSignature(pins: readonly MapPin[]): string {
    let hash = '';
    for (const pin of pins) {
        hash += `${pin.id}:${pin.status ?? '?'}:${pin.alertCount ?? 0};`;
    }
    return hash;
}

function wavePhase(timeMs: number, periodMs: number): number {
    const t = (timeMs % periodMs) / periodMs;
    return (Math.sin(t * Math.PI * 2) + 1) / 2; // 0..1
}

interface AlertPulse {
    scale: number;
    alpha: number;
}
function alertPulse(timeMs: number): AlertPulse {
    const wave = wavePhase(timeMs, ALERT_PERIOD_MS);
    return {
        scale: 0.85 + wave * 0.55, // 0.85 → 1.40
        alpha: Math.round(50 + wave * 130) // 50 → 180
    };
}

export interface PinLayerHandlers {
    onClick?: (pin: MapPin) => void;
    onHover?: (pin: MapPin | null) => void;
}

// Apple-Maps balloon pin — IconLayer with a baked SVG sprite per status.
// Selected pin is rendered as a separate larger-scale IconLayer on top.
function pinIconLayer(
    id: string,
    pins: readonly MapPin[],
    trigger: string,
    sizeMultiplier: number,
    onPick?: (info: PickingInfo) => boolean,
    onHover?: (info: PickingInfo) => void
): IconLayer<MapPin> {
    const size = PIN_SPRITE_H * sizeMultiplier;
    return new IconLayer<MapPin>({
        id,
        data: pins,
        getPosition: (d) => [d.lng, d.lat],
        getIcon: (d) => ({
            url: pinSpriteUrl(d),
            width: PIN_SPRITE_W,
            height: PIN_SPRITE_H,
            anchorY: PIN_ANCHOR_Y
        }),
        getSize: size,
        sizeUnits: 'pixels',
        sizeMinPixels: size,
        sizeMaxPixels: size,
        pickable: !!onPick,
        autoHighlight: false,
        onClick: onPick,
        onHover,
        updateTriggers: {getIcon: trigger}
    });
}

// Pulsing ring on alerting pins — visual "ping" that draws the eye.
// Radius is generous (covers the full balloon body above the tail tip + tail).
function alertHaloLayer(
    pins: readonly MapPin[],
    pulse: AlertPulse,
    trigger: string
): ScatterplotLayer<MapPin> {
    const radius = HALO_RADIUS_PX * pulse.scale;
    return new ScatterplotLayer<MapPin>({
        id: 'fm-halo-alerting',
        data: pins,
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => {
            const [r, g, b] = colorFor(d);
            return [r, g, b, pulse.alpha];
        },
        getRadius: radius,
        radiusUnits: 'pixels',
        radiusMinPixels: radius,
        radiusMaxPixels: radius,
        stroked: false,
        pickable: false,
        updateTriggers: {getFillColor: `${trigger}:${pulse.alpha}`}
    });
}

// Selection halo — single static ring under the selected pin.
function selectedHaloLayer(pin: MapPin): ScatterplotLayer<MapPin> {
    return new ScatterplotLayer<MapPin>({
        id: 'fm-halo-selected',
        data: [pin],
        getPosition: (d) => [d.lng, d.lat],
        getFillColor: (d) => {
            const [r, g, b] = colorFor(d);
            return [r, g, b, 60];
        },
        getRadius: HALO_RADIUS_PX,
        radiusUnits: 'pixels',
        radiusMinPixels: HALO_RADIUS_PX,
        radiusMaxPixels: HALO_RADIUS_PX,
        stroked: false,
        pickable: false
    });
}

export interface LocationPinOptions {
    selectedId?: string | null;
}

export function locationPinLayers(
    pins: readonly MapPin[],
    handlers: PinLayerHandlers = {},
    animation: PinAnimation = {timeMs: 0},
    options: LocationPinOptions = {}
): Layer[] {
    const click = handlers.onClick
        ? (info: PickingInfo) => {
              const pin = info.object as MapPin | undefined;
              if (pin) handlers.onClick?.(pin);
              return true;
          }
        : undefined;
    const hover = handlers.onHover
        ? (info: PickingInfo) =>
              handlers.onHover?.((info.object as MapPin) ?? null)
        : undefined;

    const trigger = pinSignature(pins);
    const {alerting} = partitionByAlerts(pins);
    const pulse = alertPulse(animation.timeMs);
    const selectedId = options.selectedId;
    const unselected = selectedId
        ? pins.filter((p) => p.id !== selectedId)
        : pins;
    const selected = selectedId
        ? (pins.find((p) => p.id === selectedId) ?? null)
        : null;

    const out: Layer[] = [];
    if (selected) out.push(selectedHaloLayer(selected));
    if (alerting.length > 0) out.push(alertHaloLayer(alerting, pulse, trigger));
    out.push(pinIconLayer('fm-pin-icon', unselected, trigger, 1, click, hover));
    if (selected) {
        out.push(
            pinIconLayer(
                'fm-pin-icon-selected',
                [selected],
                `${trigger}:sel`,
                PIN_SELECTED_SCALE,
                click,
                hover
            )
        );
    }
    return out;
}

export const __testing = {
    alertPulse,
    partitionByAlerts,
    pinSignature
};

function clusterRadius(count: number): number {
    return Math.min(
        CLUSTER_RADIUS_MAX_PX,
        CLUSTER_RADIUS_MIN_PX + Math.log2(Math.max(2, count)) * 4
    );
}

export function clusterPinLayers(
    clusters: readonly ClusterPoint[],
    onClick?: (cluster: ClusterPoint) => void
): Layer[] {
    const click = onClick
        ? (info: PickingInfo) => {
              const cluster = info.object as ClusterPoint | undefined;
              if (cluster) onClick(cluster);
              return true;
          }
        : undefined;
    const outline = outlineRgba();
    return [
        new ScatterplotLayer<ClusterPoint>({
            id: 'fm-cluster-glow',
            data: clusters,
            getPosition: (d) => [d.lng, d.lat],
            getRadius: (d) => clusterRadius(d.count),
            radiusUnits: 'pixels',
            radiusMinPixels: CLUSTER_RADIUS_MIN_PX,
            radiusMaxPixels: CLUSTER_RADIUS_MAX_PX,
            getFillColor: clusterGlowRgba(),
            stroked: false,
            pickable: false
        }),
        new ScatterplotLayer<ClusterPoint>({
            id: 'fm-cluster-disc',
            data: clusters,
            getPosition: (d) => [d.lng, d.lat],
            getRadius: (d) => clusterRadius(d.count) * 0.55,
            radiusUnits: 'pixels',
            radiusMinPixels: CLUSTER_RADIUS_MIN_PX * 0.55,
            radiusMaxPixels: CLUSTER_RADIUS_MAX_PX * 0.55,
            getFillColor: clusterFillRgba(),
            getLineColor: outline,
            getLineWidth: CLUSTER_OUTLINE_PX,
            lineWidthUnits: 'pixels',
            stroked: true,
            pickable: true,
            autoHighlight: true,
            highlightColor: [255, 255, 255, 60],
            onClick: click
        }),
        new TextLayer<ClusterPoint>({
            id: 'fm-cluster-count',
            data: clusters,
            getPosition: (d) => [d.lng, d.lat],
            getText: (d) => (d.count > 99 ? '99+' : String(d.count)),
            getSize: 12,
            sizeUnits: 'pixels',
            getColor: [255, 255, 255, 240],
            fontFamily: 'Inter, system-ui, sans-serif',
            fontWeight: 700,
            getTextAnchor: 'middle',
            getAlignmentBaseline: TEXT_LAYER_BASELINE,
            pickable: false
        })
    ];
}

function childIconSvgUrl(): string {
    const {fill, outline} = childIconColors();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="${fill}" stroke="${outline}" stroke-width="2"/><circle cx="16" cy="16" r="3" fill="#fff"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function childIconLayer(
    pins: MapPin[],
    onClick?: (pin: MapPin) => void
) {
    const url = childIconSvgUrl();
    return new IconLayer<MapPin>({
        id: 'fm-children',
        data: pins,
        getPosition: (d) => [d.lng, d.lat],
        getIcon: () => ({
            url,
            width: 32,
            height: 32,
            anchorY: 16
        }),
        getSize: 32,
        sizeUnits: 'pixels',
        pickable: !!onClick,
        onClick: onClick
            ? (info) => {
                  const pin = info.object as MapPin | undefined;
                  if (pin) onClick(pin);
                  return true;
              }
            : undefined
    });
}
