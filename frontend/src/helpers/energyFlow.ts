// Pure helpers for DashEnergyFlow rendering. No DOM, no Vue.

export const PARTICLE_DUR_MIN_S = 1;
export const PARTICLE_DUR_MAX_S = 6;

// Faster particle = larger share of total power (HA's formula).
// Floor at MIN, ceil at MAX so a single dominant edge doesn't blink.
export function particleDuration(value: number, total: number): number {
    if (!Number.isFinite(value) || value <= 0) return PARTICLE_DUR_MAX_S;
    if (!Number.isFinite(total) || total <= 0) return PARTICLE_DUR_MAX_S;
    const share = Math.min(1, value / total);
    return (
        PARTICLE_DUR_MAX_S - share * (PARTICLE_DUR_MAX_S - PARTICLE_DUR_MIN_S)
    );
}

// SVG cubic Bézier between two points. Control points pulled toward the
// midpoint along the perpendicular axis so the line curves; curvature 0
// degenerates to straight.
export function curvedEdgePath(input: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    curvature?: number;
}): string {
    const c = input.curvature ?? 0.25;
    const dx = input.toX - input.fromX;
    const dy = input.toY - input.fromY;
    const len = Math.hypot(dx, dy);
    if (len === 0) return `M ${input.fromX} ${input.fromY}`;
    const offsetX = (-dy / len) * len * c;
    const offsetY = (dx / len) * len * c;
    const cx1 = input.fromX + dx / 3 + offsetX;
    const cy1 = input.fromY + dy / 3 + offsetY;
    const cx2 = input.fromX + (2 * dx) / 3 + offsetX;
    const cy2 = input.fromY + (2 * dy) / 3 + offsetY;
    return `M ${input.fromX} ${input.fromY} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${input.toX} ${input.toY}`;
}

export function gradientId(fromId: string, toId: string): string {
    return `def-grad-${fromId}-${toId}`;
}

export function edgePathId(fromId: string, toId: string): string {
    return `def-edge-${fromId}-${toId}`;
}
