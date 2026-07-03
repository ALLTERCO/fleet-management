// Pass/fail badge for grid voltage quality. Matches the principle of EN
// 50160 (10% band) and IEEE 1159 (under/over voltage) without copying
// either standard verbatim — we own the thresholds.

export interface VoltageQualityInput {
    readonly minVoltage: number | null;
    readonly maxVoltage: number | null;
    readonly nominalVoltage: number; // typically 230 (EU) or 120 (US)
    readonly imbalancePct: number | null; // 0..100
}

export interface VoltageQualityResult {
    readonly status: 'pass' | 'fail' | 'unknown';
    readonly reasons: readonly string[];
}

const BAND_PCT = 0.1; // ± 10% — the EN-50160-style envelope
const IMBALANCE_LIMIT_PCT = 2;

export function evaluateVoltageQuality(
    input: VoltageQualityInput
): VoltageQualityResult {
    if (!hasAnySample(input)) return {status: 'unknown', reasons: []};
    const lowFail = isUnderVoltage(input);
    const highFail = isOverVoltage(input);
    const imbFail = isImbalanceExceeded(input);
    const reasons = [
        lowFail ? `min ${input.minVoltage}V below band` : null,
        highFail ? `max ${input.maxVoltage}V above band` : null,
        imbFail
            ? `imbalance ${input.imbalancePct}% over ${IMBALANCE_LIMIT_PCT}%`
            : null
    ].filter((r): r is string => r !== null);
    return {
        status: reasons.length === 0 ? 'pass' : 'fail',
        reasons
    };
}

function hasAnySample(input: VoltageQualityInput): boolean {
    return (
        input.minVoltage !== null ||
        input.maxVoltage !== null ||
        input.imbalancePct !== null
    );
}

function isUnderVoltage(input: VoltageQualityInput): boolean {
    if (input.minVoltage === null) return false;
    return input.minVoltage < input.nominalVoltage * (1 - BAND_PCT);
}

function isOverVoltage(input: VoltageQualityInput): boolean {
    if (input.maxVoltage === null) return false;
    return input.maxVoltage > input.nominalVoltage * (1 + BAND_PCT);
}

function isImbalanceExceeded(input: VoltageQualityInput): boolean {
    if (input.imbalancePct === null) return false;
    return input.imbalancePct > IMBALANCE_LIMIT_PCT;
}
