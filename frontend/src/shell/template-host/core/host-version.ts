// One comparable Fleet version, and the one floor comparison every gate runs.
//
// Fleet ships as a single artifact, so the frontend package version is the SDK
// version; a second number would be a second thing to bump, and the thing this
// file exists to stop is a version that drifts from what actually shipped.

/** Each part is packed into one integer, so no part may reach 1000. */
const PART_LIMIT = 1000;

// A build suffix (`-rc.1`, `+sha`) is dropped, so a pre-release of 1.92.0
// counts as 1.92.0: it carries the features a template asked for, and refusing
// the release candidate a customer is running would help nobody.
const VERSION_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/;

/**
 * Why one floor comparison passed or failed. What to DO about a verdict is
 * the gate's call, not this file's: a build gate fails closed on anything it
 * cannot prove is fine, the runtime refuses only what it can prove is wrong.
 */
export type HostVersionFloorVerdict =
    | 'satisfied'
    | 'below_floor'
    /** The template asked for something that is not a version. */
    | 'invalid_floor'
    /** The host cannot state a readable version. A host bug, not a template one. */
    | 'unknown_host'
    /** The template declared nothing, so no gate can refuse a wrong pairing. */
    | 'no_floor';

/**
 * A version as one integer that `<` and `>=` order correctly:
 * `1.92.0` is 1_092_000 and sorts after `1.9.0`. Null when the string is not a
 * version, so nothing silently compares as zero by accident.
 */
export function hostVersionNumber(value: string): number | null {
    if (typeof value !== 'string') return null;
    const match = VERSION_PATTERN.exec(value.trim());
    if (!match) return null;
    const major = Number(match[1]);
    const minor = Number(match[2] ?? '0');
    const patch = Number(match[3] ?? '0');
    if (major >= PART_LIMIT || minor >= PART_LIMIT || patch >= PART_LIMIT) {
        return null;
    }
    return major * PART_LIMIT * PART_LIMIT + minor * PART_LIMIT + patch;
}

/** Compares a running Fleet against the oldest one a template supports. */
export function checkHostVersionFloor(
    running: string,
    floor?: string
): HostVersionFloorVerdict {
    if (!floor) return 'no_floor';
    const wanted = hostVersionNumber(floor);
    if (wanted === null) return 'invalid_floor';
    const has = hostVersionNumber(running);
    if (has === null) return 'unknown_host';
    return has >= wanted ? 'satisfied' : 'below_floor';
}

/** The sentence for a verdict, or null when the pairing is fine. */
export function hostVersionFloorMessage(
    running: string,
    floor?: string
): string | null {
    switch (checkHostVersionFloor(running, floor)) {
        case 'below_floor':
            return `template needs Fleet Manager ${floor} or newer; this Fleet is ${running}`;
        case 'invalid_floor':
            return `minHostVersion "${floor}" is not a version like 1.92.0`;
        case 'unknown_host':
            return `this Fleet reports version "${running}", which cannot be compared with minHostVersion "${floor}"`;
        case 'no_floor':
            return 'manifest declares no minHostVersion, so nothing can refuse a Fleet this template cannot run on';
        default:
            return null;
    }
}
