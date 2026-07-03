// Pure math for FloorPlanScaleEditor. No DOM, no file I/O — that lives in
// the component. This file owns the unit math and the scale formula.

import {readEnvNumber} from '@/helpers/env';

export type DistanceUnit = 'm' | 'ft';

export interface FloorPlanValue {
    url?: string;
    widthPx?: number;
    heightPx?: number;
    scalePxPerMeter?: number;
}

export interface ScaleLine {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

// Configurable upload ceiling (bytes). Backend enforces too — this is the
// client-side preflight to skip pointless round-trips.
export const MAX_FLOOR_PLAN_BYTES = readEnvNumber(
    'VITE_FLOORPLAN_MAX_BYTES',
    5 * 1024 * 1024
);

export const ACCEPTED_FLOOR_PLAN_MIME = [
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'image/webp'
] as const;

const FEET_PER_METER = 3.28084;

// Sanity bounds. A 100x100 px sketch of a continent and a satellite photo
// scaled to one bedroom both produce nonsense scale. Reject both extremes
// so we never persist a meaningless px/m.
export const MIN_PX_PER_METER = 1; // less than 1 px/m → image is wildly tiny
export const MAX_PX_PER_METER = 10_000; // > 10k px/m → scale is unrealistic

// Answer — convert a user-entered length into metres.
export function toMeters(value: number, unit: DistanceUnit): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return unit === 'ft' ? value / FEET_PER_METER : value;
}

// Answer — pixel distance between two points on the floor plan.
export function pixelDistance(line: ScaleLine): number {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    return Math.sqrt(dx * dx + dy * dy);
}

// Answer — is a computed scale inside the believable range?
export function isReasonablePxPerMeter(value: number): boolean {
    return (
        Number.isFinite(value) &&
        value >= MIN_PX_PER_METER &&
        value <= MAX_PX_PER_METER
    );
}

// Answer — derived scale in px-per-metre. Returns 0 for invalid inputs so
// the caller can skip persisting a meaningless value.
export function pxPerMeterFromLine(args: {
    line: ScaleLine;
    realDistance: number;
    unit: DistanceUnit;
}): number {
    const meters = toMeters(args.realDistance, args.unit);
    if (meters <= 0) return 0;
    const px = pixelDistance(args.line);
    if (px <= 0) return 0;
    return px / meters;
}

// Answer — is this file shape acceptable for upload? Pure check, side-effect
// free; the component decides what to do with the verdict.
export function isAcceptedFloorPlanFile(file: {
    type: string;
    size: number;
}): {ok: true} | {ok: false; reason: 'mime' | 'size'} {
    if (!ACCEPTED_FLOOR_PLAN_MIME.includes(file.type as never)) {
        return {ok: false, reason: 'mime'};
    }
    if (file.size > MAX_FLOOR_PLAN_BYTES) {
        return {ok: false, reason: 'size'};
    }
    return {ok: true};
}
