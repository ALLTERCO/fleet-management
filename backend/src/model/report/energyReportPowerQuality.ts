// Reactive/apparent energy and voltage-excursion metrics — the power-quality
// content professional energy reports (Schneider PME, Siemens powermanager)
// carry. Derived from what the report already has: active energy, average power
// factor, and per-bucket min/max voltage. No extra device data required.

import {
    type EnergyReportRow,
    energyRow,
    energyRowBlank
} from './energyEngineHelpers';

export interface FrequencyStats {
    avgHz: number | null;
    minHz: number | null;
    maxHz: number | null;
}

export interface PowerQualityInput {
    totalConsumptionKWh: number;
    // Average power factor over the period (0..1), or null when unknown.
    avgPowerFactor: number | null;
    // Per-display-bucket min/max voltage (volts); nulls skipped.
    voltageBuckets: ReadonlyArray<{min: number | null; max: number | null}>;
    nominalVoltage: number;
    // Grid frequency over the period (null when not metered) + nominal (50/60).
    frequency: FrequencyStats | null;
    nominalHz: number;
}

export interface PowerQualityResult {
    // Estimated from active energy and average PF (constant-PF approximation).
    apparentEnergyKVAh: number | null;
    reactiveEnergyKVARh: number | null;
    // Buckets whose min/max voltage left the ±10% band (EN 50160 limit).
    underVoltageBuckets: number;
    overVoltageBuckets: number;
    sampleBuckets: number;
    frequency: FrequencyStats | null;
    // Largest absolute deviation from nominal across the period (Hz).
    frequencyDeviationHz: number | null;
}

function round3(value: number): number {
    return +value.toFixed(3);
}

// kVAh = kWh / PF ; kVARh = kWh * tan(acos(PF)) = kWh * sqrt(1/PF^2 - 1).
function reactiveApparent(
    kWh: number,
    pf: number | null
): {apparentKVAh: number | null; reactiveKVARh: number | null} {
    if (pf === null || pf <= 0 || pf > 1 || kWh <= 0) {
        return {apparentKVAh: null, reactiveKVARh: null};
    }
    const apparent = kWh / pf;
    const reactive = kWh * Math.sqrt(1 / (pf * pf) - 1);
    return {apparentKVAh: round3(apparent), reactiveKVARh: round3(reactive)};
}

function countVoltageExcursions(
    buckets: PowerQualityInput['voltageBuckets'],
    nominal: number
): {under: number; over: number; samples: number} {
    const low = nominal * 0.9;
    const high = nominal * 1.1;
    let under = 0;
    let over = 0;
    let samples = 0;
    for (const b of buckets) {
        if (typeof b.min !== 'number' && typeof b.max !== 'number') continue;
        samples++;
        if (typeof b.min === 'number' && b.min < low) under++;
        if (typeof b.max === 'number' && b.max > high) over++;
    }
    return {under, over, samples};
}

export function computePowerQuality(
    input: PowerQualityInput
): PowerQualityResult {
    const {apparentKVAh, reactiveKVARh} = reactiveApparent(
        input.totalConsumptionKWh,
        input.avgPowerFactor
    );
    const v = countVoltageExcursions(
        input.voltageBuckets,
        input.nominalVoltage
    );
    return {
        apparentEnergyKVAh: apparentKVAh,
        reactiveEnergyKVARh: reactiveKVARh,
        underVoltageBuckets: v.under,
        overVoltageBuckets: v.over,
        sampleBuckets: v.samples,
        frequency: input.frequency,
        frequencyDeviationHz: frequencyDeviation(
            input.frequency,
            input.nominalHz
        )
    };
}

// Largest absolute drift of min/max frequency from nominal.
function frequencyDeviation(
    f: FrequencyStats | null,
    nominal: number
): number | null {
    if (!f || (f.minHz === null && f.maxHz === null)) return null;
    const drifts = [f.minHz, f.maxHz]
        .filter((hz): hz is number => typeof hz === 'number')
        .map((hz) => Math.abs(hz - nominal));
    return drifts.length > 0 ? round3(Math.max(...drifts)) : null;
}

function pqRow(label: string, notes: string): EnergyReportRow {
    return energyRow({device: label, notes});
}

// Appends a POWER QUALITY section when there is reactive or voltage-band data.
export function appendPowerQualitySection(req: {
    rows: EnergyReportRow[];
    result: PowerQualityResult;
}): void {
    const r = req.result;
    const hasReactive = r.reactiveEnergyKVARh !== null;
    const hasFrequency = r.frequency?.avgHz != null;
    if (!hasReactive && r.sampleBuckets === 0 && !hasFrequency) return;
    req.rows.push(pqRow('POWER QUALITY', ''));
    if (hasReactive) {
        req.rows.push(
            pqRow(
                'Reactive energy',
                `${r.reactiveEnergyKVARh} kVARh (estimated from power factor)`
            )
        );
        req.rows.push(pqRow('Apparent energy', `${r.apparentEnergyKVAh} kVAh`));
    }
    if (r.sampleBuckets > 0) {
        req.rows.push(
            pqRow(
                'Voltage band',
                `${r.underVoltageBuckets} under / ${r.overVoltageBuckets} over of ${r.sampleBuckets} intervals (EN 50160 ±10%)`
            )
        );
    }
    if (hasFrequency && r.frequency) {
        req.rows.push(
            pqRow(
                'Frequency',
                `${r.frequency.avgHz} Hz avg (range ${r.frequency.minHz}-${r.frequency.maxHz}, max drift ±${r.frequencyDeviationHz} Hz)`
            )
        );
    }
    req.rows.push({...energyRowBlank()});
}
