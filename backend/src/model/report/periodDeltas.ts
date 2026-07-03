/** Period-over-period deltas. Pure helpers — no `this`, no I/O. */

export interface Window {
    readonly from: Date;
    readonly to: Date;
}

export interface PriorWindow {
    readonly priorFrom: Date;
    readonly priorTo: Date;
}

export interface PeriodDelta {
    readonly current: number;
    readonly prior: number | null;
    readonly deltaPct: number | null;
}

const EPOCH_MS = 0;

/** Mirror window ending right before `from`. Clamped to >= unix epoch. */
export function inferPriorWindow({from, to}: Window): PriorWindow {
    const span = to.getTime() - from.getTime();
    if (!Number.isFinite(span) || span <= 0) {
        return {priorFrom: new Date(from), priorTo: new Date(from)};
    }
    const priorToMs = from.getTime();
    const priorFromMs = Math.max(EPOCH_MS, priorToMs - span);
    return {priorFrom: new Date(priorFromMs), priorTo: new Date(priorToMs)};
}

/** Returns null deltaPct when prior is null or zero — never NaN, never Infinity.
 * Divides by abs(prior) so that the sign of (current-prior) stays meaningful
 * when prior is negative (export-heavy period): "did consumption rise?" reads
 * the same regardless of whether the baseline is import- or export-dominated.
 * Half-up rounding (Math.round) instead of toFixed's banker's rounding so the
 * value matches what users hand-compute. */
export function computeDelta(
    current: number,
    prior: number | null
): PeriodDelta {
    if (prior === null || !Number.isFinite(prior) || prior === 0) {
        return {current, prior, deltaPct: null};
    }
    const raw = ((current - prior) / Math.abs(prior)) * 100;
    return {current, prior, deltaPct: Math.round(raw * 10) / 10};
}

/** "+12.3%" / "-5.0%" / "" — caller decides whether to render. */
export function formatDeltaPct(deltaPct: number | null): string {
    if (deltaPct === null) return '';
    const sign = deltaPct >= 0 ? '+' : '';
    return `${sign}${deltaPct.toFixed(1)}%`;
}
