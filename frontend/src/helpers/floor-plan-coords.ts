// Pure coordinate math shared by 2D + 3D floor-plan views.
//
// Two conversions:
//   - normalized (0..1)            ← the canonical storage shape
//   - world XZ centred on origin   ← what the 3D scene/Pixi viewport renders
//
// Kept pure (no Three.js dependency) so the math has direct test coverage
// and the renderers don't carry extra responsibility.

export interface FloorSize {
    planW: number;
    planH: number;
}

export interface WorldXZ {
    x: number;
    z: number;
}

export interface NormalizedXY {
    x: number;
    y: number;
}

// 0..1 → centred world XZ. Uses the plan's own width/height so rectangular
// plans don't squash. Falls back to a square `fallback` size when no plan
// has loaded yet (e.g. while the texture/walls fetch is in flight).
export function normalizedToWorld(
    p: NormalizedXY,
    size: FloorSize | null,
    fallback: number
): WorldXZ {
    const w = size?.planW ?? fallback;
    const h = size?.planH ?? fallback;
    return {x: (p.x - 0.5) * w, z: (p.y - 0.5) * h};
}

// Inverse of normalizedToWorld. Returns the (0, 0)..(1, 1) coords that the
// rest of the app stores in `kindFields.devicePlacements`.
export function worldToNormalizedXY(
    world: WorldXZ,
    size: FloorSize
): NormalizedXY {
    return {
        x: (world.x + size.planW / 2) / size.planW,
        y: (world.z + size.planH / 2) / size.planH
    };
}
