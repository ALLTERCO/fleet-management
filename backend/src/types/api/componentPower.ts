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
// Per-phase voltage/current on a 3-phase EM component (em:N). EM1 reports bare.
export const PHASE_VOLTAGE_FIELDS: Readonly<Record<'a' | 'b' | 'c', string>> = {
    a: 'a_voltage',
    b: 'b_voltage',
    c: 'c_voltage'
};
export const PHASE_CURRENT_FIELDS: Readonly<Record<'a' | 'b' | 'c', string>> = {
    a: 'a_current',
    b: 'b_current',
    c: 'c_current'
};
export const SINGLE_ACTIVE_POWER_FIELDS = ['apower', 'act_power'] as const;
export const TOTAL_ACTIVE_POWER_FIELD = 'total_act_power';
// Bare voltage/current on a single-phase component (em1:N, switch:N, pm1:N).
export const SINGLE_VOLTAGE_FIELD = 'voltage';
export const SINGLE_CURRENT_FIELD = 'current';
// Network frequency (Hz) — reported only on AC components (DC does not
// alternate, so it has none). Drives the AC/DC domain auto-detector.
export const SINGLE_FREQ_FIELD = 'freq';
// AC-mains detection threshold (volts). With no frequency, a reading at/above
// this is treated as AC (covers US 120 V and EU 230 V); clearly below it is
// ambiguous (LED rail ~12/24 V, DC bus, or an AC brownout) and left
// unspecified for the operator to declare. Overridable via
// FM_ENERGY_AC_MIN_VOLTAGE.
export const AC_MIN_VOLTAGE_DEFAULT = 90;
// Cumulative energy counters embedded in a component's live status (Wh).
export const CONSUMED_ENERGY_PATH = 'aenergy.total';
export const RETURNED_ENERGY_PATH = 'ret_aenergy.total';

// Every component prefix that reports AC active power. `em` is 3-phase (a/b/c);
// the rest report a single reading. THE single home for this list — the live
// fleet metrics and the ingestion classifier both derive from it, so a new
// metered component type is added here once. (DC battery `bm` is a separate
// domain and is intentionally not here.)
export const AC_ACTIVE_POWER_COMPONENTS = [
    'switch',
    'pm1',
    'cover',
    'light',
    'rgb',
    'rgbw',
    'cct',
    'rgbcct',
    'em1',
    'em'
] as const;

// Pro 3EM monophase profile has em1:0/1/2; scan a small range with margin.
const MAX_PHASE_CHANNELS = 4;

function num(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
}

// One phase of a 3-phase EM component. channel 0/1/2 == phase a/b/c == L1/L2/L3.
export interface EmPhaseChannel {
    channel: number;
    act_power: number | null;
    voltage: number | null;
    current: number | null;
}

// Expand one 3-phase em:N (a_/b_/c_ sub-fields) into per-phase channels. em1:N
// is a separate single-phase component, not this shape.
export function emPhaseChannels(
    status: Record<string, unknown>
): EmPhaseChannel[] {
    const phases = ['a', 'b', 'c'] as const;
    const out: EmPhaseChannel[] = [];
    for (let i = 0; i < phases.length; i++) {
        const phase = phases[i];
        const act_power = num(status[PHASE_ACTIVE_POWER_FIELDS[phase]]);
        const voltage = num(status[PHASE_VOLTAGE_FIELDS[phase]]);
        const current = num(status[PHASE_CURRENT_FIELDS[phase]]);
        if (act_power === null && voltage === null && current === null)
            continue;
        out.push({channel: i, act_power, voltage, current});
    }
    return out;
}

// One em1:N single-phase meter as a phase channel. In the Pro 3EM monophase
// profile em1:0/1/2 ARE the three phases, so the em1 index IS the phase.
function em1PhaseChannel(
    channel: number,
    status: Record<string, unknown>
): EmPhaseChannel {
    return {
        channel,
        act_power: componentActivePower(status),
        voltage: num(status[SINGLE_VOLTAGE_FIELD]),
        current: num(status[SINGLE_CURRENT_FIELD])
    };
}

// All phase channels a device exposes: triphase em:N (a/b/c) or monophase
// em1:0/1/2. Count decides downstream (>=3 == 3-phase); 2 em1 stays independent.
export function devicePhaseChannels(
    status: Record<string, unknown>
): EmPhaseChannel[] {
    const channels: EmPhaseChannel[] = [];
    for (let i = 0; i < MAX_PHASE_CHANNELS; i++) {
        const em = status[`em:${i}`];
        if (em && typeof em === 'object')
            channels.push(...emPhaseChannels(em as Record<string, unknown>));
        const em1 = status[`em1:${i}`];
        if (em1 && typeof em1 === 'object')
            channels.push(em1PhaseChannel(i, em1 as Record<string, unknown>));
    }
    return channels;
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
