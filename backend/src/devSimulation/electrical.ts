/** AC model shared by the simulator's baselines and its drift, so every
 *  emitted status closes the power triangle: S = |P| / PF and I = S / V. */

export const EM_PHASES = ['a', 'b', 'c'] as const;

export const NOMINAL_VOLTAGE_V = 230;
export const NOMINAL_FREQUENCY_HZ = 50;

/** Fallback when a profile reports no power factor of its own. */
export const DEFAULT_POWER_FACTOR = 0.95;

/** Band that domestic and small-commercial loads run inside. */
const POWER_FACTOR_MIN = 0.85;
const POWER_FACTOR_MAX = 0.99;

/** How far the power factor swings with the load over one drift cycle. */
const POWER_FACTOR_SWING = 0.03;

/** Grid frequency is held tight; a wider wobble reads as a disturbance. */
const FREQUENCY_SWING_HZ = 0.04;

/** Line angles of a three-phase system, phase A taken as the reference. */
const LINE_ANGLES_RAD = [0, (-2 * Math.PI) / 3, (2 * Math.PI) / 3] as const;

export interface PhasorReading {
    actPower: number;
    aprtPower: number;
    current: number;
    powerFactor: number;
}

/** De-energised channel: Shelly reports zeros, including `pf: 0.00`. */
const IDLE_READING: PhasorReading = {
    actPower: 0,
    aprtPower: 0,
    current: 0,
    powerFactor: 0
};

export function round(value: number, digits = 2): number {
    return Number(value.toFixed(digits));
}

export function clampPowerFactor(powerFactor: number): number {
    return Math.min(POWER_FACTOR_MAX, Math.max(POWER_FACTOR_MIN, powerFactor));
}

/** Power factor moves with the load, on the same wave as the power. */
export function driftPowerFactor(base: number, wave: number): number {
    return round(clampPowerFactor(base + wave * POWER_FACTOR_SWING), 3);
}

export function driftFrequency(wave: number): number {
    return round(NOMINAL_FREQUENCY_HZ + wave * FREQUENCY_SWING_HZ, 2);
}

/** Power factor implied by a baseline with current and power but no `pf`.
 *  Unclamped: a DC LED rail really does run at 1, callers that model an AC
 *  load clamp it into the domestic band themselves. */
export function impliedPowerFactor(input: {
    actPower: number | undefined;
    voltage: number | undefined;
    current: number | undefined;
}): number | undefined {
    const {actPower, voltage, current} = input;
    if (actPower === undefined || voltage === undefined) return undefined;
    if (current === undefined || voltage <= 0 || current <= 0) return undefined;
    return Math.min(1, Math.abs(actPower) / (voltage * current));
}

/** Share of a lit LED channel's rated power that its driver draws at any
 *  level, so a strip at 1% still costs more than a dark one. */
const LIGHTING_DRIVER_SHARE = 0.08;

function lightingLoadFactor(brightnessPercent: number): number {
    if (!(brightnessPercent >= 0 && brightnessPercent <= 100)) {
        throw new Error(
            `simulated brightness must be within [0, 100]: ${brightnessPercent}`
        );
    }
    return (
        LIGHTING_DRIVER_SHARE +
        (1 - LIGHTING_DRIVER_SHARE) * (brightnessPercent / 100)
    );
}

/** Draw of an LED channel at a dimmed level: the driver's fixed share plus
 *  emitters that track brightness. */
export function lightingPower(input: {
    ratedPower: number;
    brightnessPercent: number;
}): number {
    if (!(input.ratedPower > 0)) {
        throw new Error(
            `simulated rated power must be positive: ${input.ratedPower}`
        );
    }
    return round(
        input.ratedPower * lightingLoadFactor(input.brightnessPercent)
    );
}

/** Inverse of `lightingPower`: the rating behind a baseline that was authored
 *  at `brightnessPercent`, so drift can re-derive power at any other level. */
export function ratedLightingPower(input: {
    actPower: number;
    brightnessPercent: number;
}): number {
    return round(
        input.actPower / lightingLoadFactor(input.brightnessPercent),
        3
    );
}

/** S >= |P| and PF = |P| / S by construction. Rounded in dependency order so
 *  the emitted numbers satisfy the identity, not just the pre-rounding ones. */
export function powerTriangle(input: {
    actPower: number;
    voltage: number;
    powerFactor: number;
}): PhasorReading {
    if (!(input.voltage > 0)) {
        throw new Error(`simulated voltage must be positive: ${input.voltage}`);
    }
    const actPower = round(input.actPower);
    if (actPower === 0) return {...IDLE_READING};
    if (!(input.powerFactor > 0 && input.powerFactor <= 1)) {
        throw new Error(
            `simulated power factor must be within (0, 1]: ${input.powerFactor}`
        );
    }
    const powerFactor = round(input.powerFactor, 3);
    const aprtPower = round(Math.abs(actPower) / powerFactor);
    return {
        actPower,
        aprtPower,
        current: round(aprtPower / input.voltage, 3),
        powerFactor
    };
}

/** Vector sum of the three line currents. Each lags its voltage by acos(PF);
 *  an exporting phase is that phasor turned through 180 degrees. */
export function neutralCurrent(phases: readonly PhasorReading[]): number {
    if (phases.length !== LINE_ANGLES_RAD.length) {
        throw new Error(
            `neutral current needs ${LINE_ANGLES_RAD.length} phases, got ${phases.length}`
        );
    }
    let real = 0;
    let imaginary = 0;
    phases.forEach((phase, index) => {
        const lag = phase.powerFactor > 0 ? Math.acos(phase.powerFactor) : 0;
        const exporting = phase.actPower < 0 ? Math.PI : 0;
        const angle = LINE_ANGLES_RAD[index] - lag + exporting;
        real += phase.current * Math.cos(angle);
        imaginary += phase.current * Math.sin(angle);
    });
    return round(Math.hypot(real, imaginary), 3);
}
