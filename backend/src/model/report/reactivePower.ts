// Reactive power (kVAr) derived from apparent (VA) and real (W) per the
// power triangle: Q² = S² - P². Negative-under-root collapses to 0.

export interface ReactivePowerInput {
    readonly apparentVA: number;
    readonly realW: number;
}

export function reactivePowerVAr(input: ReactivePowerInput): number {
    if (!Number.isFinite(input.apparentVA)) return 0;
    if (!Number.isFinite(input.realW)) return 0;
    const s2 = input.apparentVA * input.apparentVA;
    const p2 = input.realW * input.realW;
    if (s2 <= p2) return 0;
    return Math.round(Math.sqrt(s2 - p2));
}
