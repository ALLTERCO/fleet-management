// Floor-plan types. Coords are normalized 0..1 so re-uploading a
// plan at a different size doesn't invalidate existing placements.
// Persisted under location.kindFields (free-form blob, no migration).

import type {FixtureKind as ApiFixtureKind} from '@api/location';

export interface FloorPlanRef {
    url: string;
    widthPx: number;
    heightPx: number;
}

/** A point on the plan, normalized 0..1. One type for every geometry the
 *  plan carries so zones, walls and placements share a coordinate space. */
export interface PlanPoint {
    x: number;
    y: number;
}

export interface DevicePlacement {
    x: number;
    y: number;
    rot?: number;
    /** What 3D fixture the Shelly device controls (lamp, fridge, AC,
     *  etc.). The 3D view renders this fixture; the linked Shelly
     *  device's state drives its emissive / animation. Omit to fall
     *  back to a generic pin. */
    fixture?: FixtureKind;
}

export type FixtureCategory =
    | 'lighting'
    | 'hvac'
    | 'appliance'
    | 'solar'
    | 'smart'
    | 'control'
    | 'entertainment'
    | 'access'
    | 'furniture';

// Closed set owned by the backend contract (validated by the location
// placement schema). Re-exported so the 3D code has one import site.
export type FixtureKind = ApiFixtureKind;

export type DevicePlacementMap = Record<string, DevicePlacement>;

export interface ZoneShape {
    id: string;
    name: string;
    color: string;
    points: PlanPoint[];
}

/** One straight run of wall.
 *
 *  Walls reach a floor two ways — auto-extracted from an uploaded SVG, or
 *  drawn by hand — and D-032 requires both to end up as the same thing.
 *  This is that thing: endpoints in the same normalized 0..1 space as
 *  zones and placements, so the 3D extruder never asks where a segment
 *  came from. */
export interface WallSegment {
    from: PlanPoint;
    to: PlanPoint;
}

export interface FloorPlanKindFields {
    floorPlan?: FloorPlanRef;
    devicePlacements?: DevicePlacementMap;
    zones?: ZoneShape[];
    walls?: WallSegment[];
}

export interface DevicePaletteItem {
    id: string;
    label: string;
    iconColor: string;
    status?: 'on' | 'off' | 'warn' | 'unknown';
}
