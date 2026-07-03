import {HOURS_PER_DAY} from '../../modules/util/timeUnits';
// Concrete time-shift suggestion. Given hourly load + hourly carbon intensity,
// answer the worst→best swap that avoids the most CO₂.

export interface TimeShiftInput {
    readonly hourlyConsumptionKWh: readonly number[];
    readonly hourlyIntensityGPerKWh: readonly number[];
    readonly maxShiftableKWh: number;
    /** Caller signals that hourlyIntensityGPerKWh degraded to a flat static
     *  factor (carbon provider failure). Forwarded into the result so UIs
     *  can label avoidedKgCO2 as an estimate. */
    readonly carbonDegraded?: boolean;
}

export interface TimeShiftPlan {
    readonly fromHour: number;
    readonly toHour: number;
    readonly shiftedKWh: number;
    readonly avoidedKgCO2: number;
    readonly worstGPerKWh: number;
    readonly bestGPerKWh: number;
    /** True when the carbon curve fell back to a static LBM factor instead
     *  of real-time hourly data — UI must label the avoidedKgCO2 as estimate. */
    readonly carbonDegraded?: boolean;
}

export function planTimeShift(input: TimeShiftInput): TimeShiftPlan | null {
    if (!isValid(input)) return null;
    const worst = pickHour(input.hourlyIntensityGPerKWh, 'max');
    const best = pickHour(input.hourlyIntensityGPerKWh, 'min');
    if (worst.hour === best.hour) return null;
    const shiftable = Math.min(
        input.hourlyConsumptionKWh[worst.hour] ?? 0,
        input.maxShiftableKWh
    );
    if (shiftable <= 0) return null;
    const savedGrams = shiftable * (worst.value - best.value);
    if (savedGrams <= 0) return null;
    return {
        fromHour: worst.hour,
        toHour: best.hour,
        shiftedKWh: +shiftable.toFixed(3),
        avoidedKgCO2: +(savedGrams / 1000).toFixed(2),
        worstGPerKWh: +worst.value.toFixed(2),
        bestGPerKWh: +best.value.toFixed(2),
        ...(input.carbonDegraded ? {carbonDegraded: true} : {})
    };
}

function isValid(input: TimeShiftInput): boolean {
    if (input.hourlyConsumptionKWh.length !== HOURS_PER_DAY) return false;
    if (input.hourlyIntensityGPerKWh.length !== HOURS_PER_DAY) return false;
    if (!Number.isFinite(input.maxShiftableKWh)) return false;
    if (input.maxShiftableKWh <= 0) return false;
    return true;
}

function pickHour(
    series: readonly number[],
    mode: 'min' | 'max'
): {hour: number; value: number} {
    const seed = mode === 'max' ? -Infinity : Infinity;
    const better =
        mode === 'max'
            ? (a: number, b: number) => a > b
            : (a: number, b: number) => a < b;
    let hour = 0;
    let value = seed;
    for (let i = 0; i < series.length; i += 1) {
        const v = series[i];
        if (Number.isFinite(v) && better(v, value)) {
            hour = i;
            value = v;
        }
    }
    return {hour, value};
}
