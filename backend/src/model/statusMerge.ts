// Deep-merge status objects and collect field-level changes (path, prev,
// next) in a single walk. Pattern mirrors OSIsoft PI's Snapshot Subsystem:
// previous and current values are kept adjacent in one structure so the
// flush path never has to round-trip to durable storage to compute deltas.
// Lives in its own module so tests can exercise it without dragging the
// AbstractDevice class graph + its transitive imports.

const MAX_MERGE_DEPTH = 10;

/** A single leaf-level change discovered during a merge. */
export interface PathChange {
    /** Absolute dot-path of the leaf, e.g. "switch:0.output". */
    path: string;
    /** Value before the merge. `undefined` if the leaf didn't exist. */
    prev: unknown;
    /** Value after the merge. `undefined` only if the patch carried `null`
     *  and the original was missing — a sentinel-clear case. */
    next: unknown;
}

export interface MergeDiffResult {
    /** The merged status object (same reference semantics as the old merge). */
    merged: any;
    /** Leaf-level changes. Empty when nothing changed. */
    changes: PathChange[];
}

/**
 * Deep-merge `patch` into `original` and collect the leaf-level changes
 * with both previous and new values. Single-pass: diff falls out of the
 * same key iteration the merge already does.
 *
 * `prefix` is the dot-path of `original` within the wider status tree —
 * callers usually pass the component key ("switch:0") so the returned
 * paths are absolute ("switch:0.output").
 */
export function mergeStatusAndDiff(
    original: any,
    patch: any,
    prefix: string,
    out: PathChange[] = [],
    depth = 0
): MergeDiffResult {
    if (patch === undefined) return {merged: original, changes: out};

    if (depth > MAX_MERGE_DEPTH) {
        if (original !== patch)
            out.push({path: prefix, prev: original, next: patch});
        return {merged: patch, changes: out};
    }

    const origIsObj = typeof original === 'object' && original != null;
    const patchIsObj = typeof patch === 'object' && patch != null;

    // Arrays are replaced wholesale; merging by index would leave stale
    // trailing elements. Record a change iff the array reference or shape
    // differs from the previous one.
    if (Array.isArray(patch)) {
        if (!Array.isArray(original) || !arraysShallowEqual(original, patch)) {
            out.push({path: prefix, prev: original, next: patch});
        }
        return {merged: patch, changes: out};
    }

    if (origIsObj && patchIsObj) {
        for (const key of Object.keys(patch)) {
            if (
                key === '__proto__' ||
                key === 'constructor' ||
                key === 'prototype'
            )
                continue;
            const sub = prefix ? `${prefix}.${key}` : key;
            const r = mergeStatusAndDiff(
                original[key],
                patch[key],
                sub,
                out,
                depth + 1
            );
            original[key] = r.merged;
        }
        return {merged: original, changes: out};
    }

    // Leaf assignment.
    if (original !== patch)
        out.push({path: prefix, prev: original, next: patch});
    return {merged: patch, changes: out};
}

/** Back-compat shim — callers that don't need the diff still work. */
export function mergeStatusObjects(original: any, patch: any): any {
    return mergeStatusAndDiff(original, patch, '').merged;
}

/** Convenience for callers (EventDistributor path filter, etc.) that only
 *  need the changed paths, not the prev/next values. */
export function pathsOf(changes: readonly PathChange[]): string[] {
    return changes.map((c) => c.path);
}

function arraysShallowEqual(a: unknown[], b: unknown[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}
