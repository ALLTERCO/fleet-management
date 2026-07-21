// Reactive patch/reconcile helpers. Dependency-free so the store and the
// websocket transport can both import them without an import cycle.

/**
 * Apply a patch to a reactive target object in place.
 * Only changed leaf values trigger Vue reactivity updates.
 * Arrays and primitives are replaced entirely; nested objects are recursed.
 * Never deletes keys — a key absent from the patch keeps its current value.
 */
export function applyPatch(target: any, patch: any): void {
    if (!target || typeof target !== 'object' || Array.isArray(target)) return;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return;
    for (const key of Object.keys(patch)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        const patchVal = patch[key];
        const targetVal = target[key];
        if (
            patchVal &&
            typeof patchVal === 'object' &&
            !Array.isArray(patchVal) &&
            targetVal &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            applyPatch(targetVal, patchVal);
        } else if (targetVal !== patchVal) {
            target[key] = patchVal;
        }
    }
}

/**
 * Reconcile a reactive object with a full snapshot.
 * Missing keys are removed, nested objects are synced recursively,
 * arrays/primitives are replaced.
 */
export function applySnapshot(target: any, snapshot: any): void {
    if (
        !target ||
        typeof target !== 'object' ||
        Array.isArray(target) ||
        !snapshot ||
        typeof snapshot !== 'object' ||
        Array.isArray(snapshot)
    ) {
        return;
    }

    for (const key of Object.keys(target)) {
        if (
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
        ) {
            continue;
        }
        if (!(key in snapshot)) {
            delete target[key];
        }
    }

    for (const key of Object.keys(snapshot)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype')
            continue;
        const snapshotVal = snapshot[key];
        const targetVal = target[key];
        if (
            snapshotVal &&
            typeof snapshotVal === 'object' &&
            !Array.isArray(snapshotVal) &&
            targetVal &&
            typeof targetVal === 'object' &&
            !Array.isArray(targetVal)
        ) {
            applySnapshot(targetVal, snapshotVal);
        } else if (targetVal !== snapshotVal) {
            target[key] = snapshotVal;
        }
    }
}
