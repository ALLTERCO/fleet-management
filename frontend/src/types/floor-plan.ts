// Floor-plan types. Coords are normalized 0..1 so re-uploading a
// plan at a different size doesn't invalidate existing placements.
// Persisted under location.kindFields (free-form blob, no migration).

export interface FloorPlanRef {
    url: string;
    widthPx: number;
    heightPx: number;
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

export type FixtureKind =
    // Lighting
    | 'ceiling-light'
    | 'pendant'
    | 'spotlight'
    | 'chandelier'
    | 'street-light'
    | 'floor-lamp'
    | 'table-lamp'
    | 'wall-sconce'
    | 'led-strip'
    // HVAC
    | 'ac-wall'
    | 'ac-ceiling'
    | 'radiator'
    | 'water-heater'
    | 'ceiling-fan'
    | 'thermostat'
    | 'vent'
    // Appliances
    | 'fridge'
    | 'oven'
    | 'dishwasher'
    | 'microwave'
    | 'washing-machine'
    | 'dryer'
    // Solar / energy
    | 'solar-panel'
    | 'solar-inverter'
    | 'battery-wall'
    // Smart fixtures
    | 'doorbell'
    | 'smoke-detector'
    | 'motion-sensor'
    | 'smart-blind'
    | 'smart-curtain'
    | 'houseplant'
    // Wall controls
    | 'wall-outlet'
    | 'wall-switch'
    // Entertainment
    | 'tv'
    | 'monitor'
    | 'computer'
    // Smart access
    | 'smart-lock'
    | 'door'
    | 'garage'
    // Furniture (context — controlled indirectly via smart plugs)
    | 'sofa'
    | 'chair'
    | 'table'
    | 'bed'
    | 'bookshelf'
    | 'window';

export type DevicePlacementMap = Record<string, DevicePlacement>;

export interface ZoneShape {
    id: string;
    name: string;
    color: string;
    points: Array<{x: number; y: number}>;
}

export interface FloorPlanKindFields {
    floorPlan?: FloorPlanRef;
    devicePlacements?: DevicePlacementMap;
    zones?: ZoneShape[];
}

export interface DevicePaletteItem {
    id: string;
    label: string;
    iconColor: string;
    status?: 'on' | 'off' | 'warn' | 'unknown';
}
