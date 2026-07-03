/** Single source of truth for stacked-modal state.
 *
 *  Two responsibilities live here, each behind its own pair of functions:
 *
 *   1. Depth allocation — every opening modal gets a unique slot so its
 *      overlay can dim everything beneath it.
 *   2. Body scroll lock — when any modal is open, the page behind must
 *      not scroll; the lock counts open modals and only restores the
 *      original overflow when the last modal closes.
 *
 *  The two concerns are kept apart so each function does one thing.
 */

const activeDepths = new Set<number>();
let highestDepthEverIssued = 0;

let bodyLockCount = 0;
let bodyOverflowBeforeLock = '';

/** Allocate a new modal depth slot. Always greater than every active slot
 *  so the caller's overlay correctly dims everything beneath it. */
export function reserveModalDepth(): number {
    highestDepthEverIssued += 1;
    activeDepths.add(highestDepthEverIssued);
    return highestDepthEverIssued;
}

/** Free a previously reserved depth slot. Safe to call out of LIFO order. */
export function releaseModalDepth(depth: number): void {
    activeDepths.delete(depth);
    if (activeDepths.size === 0) highestDepthEverIssued = 0;
}

/** Number of currently open modals (depth slots in use). */
export function openModalDepthCount(): number {
    return activeDepths.size;
}

/** Stop the page behind a modal from scrolling. Reentrant — safe to call
 *  for every nested modal; only the first call actually mutates overflow. */
export function lockBodyScroll(): void {
    bodyLockCount += 1;
    if (bodyLockCount === 1) {
        bodyOverflowBeforeLock = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
    }
}

/** Release one body-scroll lock. Restores the original overflow value only
 *  when the last lock is released. */
export function unlockBodyScroll(): void {
    if (bodyLockCount === 0) return;
    bodyLockCount -= 1;
    if (bodyLockCount === 0) {
        document.body.style.overflow = bodyOverflowBeforeLock;
        bodyOverflowBeforeLock = '';
    }
}

/** Test-only reset. Restores module state to the values it had at import
 *  time so each test starts from a clean slate. */
export function _resetModalStackForTests(): void {
    activeDepths.clear();
    highestDepthEverIssued = 0;
    bodyLockCount = 0;
    bodyOverflowBeforeLock = '';
}
