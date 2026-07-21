// Single home for the Cury vial wire semantics. The firmware reports a slot
// with serial '0000000000000000' when no vial is inserted and level -1 while
// the tag is still being read; consumers should not re-implement those rules.
// The projection is additive: raw slot fields stay untouched.

export const EMPTY_VIAL_SERIAL = '0000000000000000';

export type CuryVialSlot = 'left' | 'right';

export interface ProjectedCuryVial {
    slot: CuryVialSlot;
    /** A real vial is inserted (serial present and not the empty sentinel). */
    present: boolean;
    /** Resolved fill level 0-100, or null (absent vial / still reading). */
    level: number | null;
    /** Vial inserted but the level is not readable yet (-1 on the wire). */
    stillReading: boolean;
}

interface RawCurySlot {
    vial?: {serial?: unknown; level?: unknown};
}

function projectVial(slot: CuryVialSlot, raw: unknown): ProjectedCuryVial {
    const vial =
        raw !== null && typeof raw === 'object'
            ? (raw as RawCurySlot).vial
            : undefined;
    const serial = typeof vial?.serial === 'string' ? vial.serial : '';
    const present = serial.length > 0 && serial !== EMPTY_VIAL_SERIAL;
    const rawLevel = typeof vial?.level === 'number' ? vial.level : null;
    const stillReading = present && rawLevel !== null && rawLevel < 0;
    const level =
        present && rawLevel !== null && rawLevel >= 0 ? rawLevel : null;
    return {slot, present, level, stillReading};
}

// Why min: when either vial runs out the device stops doing its job, so the
// worst vial is the one the user must know about.
function lowestLevel(vials: ProjectedCuryVial[]): number | null {
    const levels = vials
        .map((vial) => vial.level)
        .filter((level): level is number => level !== null);
    return levels.length > 0 ? Math.min(...levels) : null;
}

/** Adds `vials` + `lowestVialLevel` to a cury component status in place.
 *  No-op unless the status carries a `slots` object. */
export function projectCuryVials<T>(status: T): T {
    if (status === null || typeof status !== 'object') return status;
    const slots = (status as {slots?: unknown}).slots;
    if (slots === null || typeof slots !== 'object') return status;
    const raw = slots as {left?: unknown; right?: unknown};
    const vials = [
        projectVial('left', raw.left),
        projectVial('right', raw.right)
    ];
    const projected = status as T & {
        vials: ProjectedCuryVial[];
        lowestVialLevel: number | null;
    };
    projected.vials = vials;
    projected.lowestVialLevel = lowestLevel(vials);
    return projected;
}

/** Component-status projection hook: resolved fields derived from raw wire
 *  fields, applied wherever a component status is stored on the device. */
export function applyStatusProjection<T>(key: string, status: T): T {
    if (key.startsWith('cury:')) return projectCuryVials(status);
    return status;
}
