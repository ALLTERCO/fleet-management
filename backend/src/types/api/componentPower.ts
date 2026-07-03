// Active power (W) for one Shelly component, read from its status object.
// THE single home for the field->power rule, shared across both runtimes:
// the backend live-power extractor imports it directly, and the frontend host
// imports it via the @api alias (@api/* -> backend/src/types/api/*). Kept
// dependency-free so it bundles cleanly into the browser.
//
// Field priority (component-type agnostic — the present fields decide):
//   1. per-phase a/b/c_act_power (3-phase meter) — one reading per phase
//   2. apower (Switch / PM1 / Cover / Light) or act_power (EM1) — single
//   3. total_act_power — fallback when only the total is reported
//
// The ingestion classifier (energyClassifier) must agree with these field
// names; componentPowerClassifierConsistency.test.ts pins the two together.

export type ActivePowerPhase = 'a' | 'b' | 'c' | 'z';

export interface ActivePowerReading {
    // 'z' = single / whole-component reading; a|b|c = one phase of a meter.
    phase: ActivePowerPhase;
    // Signed instantaneous active power in watts (export = negative).
    watts: number;
}

export const PHASE_ACTIVE_POWER_FIELDS: Readonly<
    Record<'a' | 'b' | 'c', string>
> = {
    a: 'a_act_power',
    b: 'b_act_power',
    c: 'c_act_power'
};
export const SINGLE_ACTIVE_POWER_FIELDS = ['apower', 'act_power'] as const;
export const TOTAL_ACTIVE_POWER_FIELD = 'total_act_power';

function num(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
}

// One reading per active-power field a component reports. Per-phase wins over
// the total, so a 3-phase meter's phases never double-count; the total is the
// fallback only when no per-field power exists. Empty when there is none.
export function componentPowerReadings(
    status: Record<string, unknown>
): ActivePowerReading[] {
    const readings: ActivePowerReading[] = [];
    for (const phase of ['a', 'b', 'c'] as const) {
        const value = num(status[PHASE_ACTIVE_POWER_FIELDS[phase]]);
        if (value !== null) readings.push({phase, watts: value});
    }
    if (readings.length > 0) return readings;

    for (const field of SINGLE_ACTIVE_POWER_FIELDS) {
        const value = num(status[field]);
        if (value !== null) return [{phase: 'z', watts: value}];
    }

    const total = num(status[TOTAL_ACTIVE_POWER_FIELD]);
    if (total !== null) return [{phase: 'z', watts: total}];
    return [];
}

// Total active power for a component (sum of its readings), or null when it
// reports none.
export function componentActivePower(
    status: Record<string, unknown>
): number | null {
    const readings = componentPowerReadings(status);
    if (readings.length === 0) return null;
    let total = 0;
    for (const reading of readings) total += reading.watts;
    return total;
}
