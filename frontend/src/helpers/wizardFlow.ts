// Wizard flow: which step you are on, which you may jump to, and what the
// strip along the bottom says.
//
// The strip is the review. Every one of these flows produces a sentence about
// something physical — "when the kitchen door opens, tell ops on-call" — so a
// finished segment shows the value the user chose, not a tick. That removes
// the review step entirely: the summary has been assembling the whole time.
//
// Pure functions. The composable holds the ref; these decide the rules.

export interface WizardStepDef {
    /** Stable identity — used by tests, the scroller, and the strip. */
    id: string;
    /** What the segment reads before anything is chosen. */
    label: string;
    /** Is this step satisfied? Gates advancing past it. */
    complete: boolean;
    /** The chosen value, shown in place of the label once there is one. */
    summary?: string;
}

export type WizardSegmentState = 'done' | 'current' | 'pending';

export interface WizardSegment {
    id: string;
    text: string;
    state: WizardSegmentState;
    /** May the user click this segment to jump to it? */
    reachable: boolean;
}

/**
 * A step is reachable when every step before it is satisfied.
 *
 * Jumping back is always allowed — going back to change one word should not
 * cost three clicks — and that stays true even from a step whose own answer
 * is still missing.
 */
export function canReachStep(
    steps: readonly WizardStepDef[],
    index: number
): boolean {
    if (index < 0 || index >= steps.length) return false;
    return steps.slice(0, index).every((step) => step.complete);
}

/** The first step still waiting for an answer, or the last one when all are done. */
export function firstIncompleteIndex(steps: readonly WizardStepDef[]): number {
    const found = steps.findIndex((step) => !step.complete);
    return found === -1 ? Math.max(0, steps.length - 1) : found;
}

/** The strip's view model — one segment per step, in order. */
export function describeSegments(
    steps: readonly WizardStepDef[],
    currentIndex: number
): WizardSegment[] {
    return steps.map((step, index) => ({
        id: step.id,
        text: segmentText(step, index === currentIndex),
        state: segmentState(step, index - currentIndex),
        reachable: canReachStep(steps, index)
    }));
}

/** Answer: can the user leave this step forwards? */
export function canAdvance(
    steps: readonly WizardStepDef[],
    currentIndex: number
): boolean {
    const step = steps[currentIndex];
    return !!step?.complete && currentIndex < steps.length - 1;
}

/** Answer: is this the step where the flow is committed? */
export function isFinalStep(
    steps: readonly WizardStepDef[],
    currentIndex: number
): boolean {
    return steps.length > 0 && currentIndex === steps.length - 1;
}

/** Keeps the index inside the flow when steps appear or disappear mid-run. */
export function clampStepIndex(
    steps: readonly WizardStepDef[],
    index: number
): number {
    if (steps.length === 0) return 0;
    return Math.min(Math.max(index, 0), steps.length - 1);
}

// A step you are standing in shows what it asks for, not a half-typed answer —
// the answer is right there on screen. Behind you, the answer is all that matters.
function segmentText(step: WizardStepDef, isCurrent: boolean): string {
    if (isCurrent) return step.label;
    return step.summary?.trim() || step.label;
}

function segmentState(
    step: WizardStepDef,
    offsetFromCurrent: number
): WizardSegmentState {
    if (offsetFromCurrent === 0) return 'current';
    return step.complete ? 'done' : 'pending';
}
