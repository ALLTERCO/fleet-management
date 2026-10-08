// Tags that carry an hour-of-week baseline, and the grain each one is keyed at.
// Power-quality diagnostics, min/max derivatives and battery state are left
// out: their "normal" is not a repeating weekly behaviour. Adding a tag here is
// enough to have the next rebuild fill it.
// Imports _energyTags only; energy.ts imports this file, so the reverse edge
// would be a cycle.

import type {ENERGY_TABLE_TAGS_LIST, ENV_TABLE_TAGS_LIST} from './_energyTags';

type EnergyTableTag = (typeof ENERGY_TABLE_TAGS_LIST)[number];
type EnvTableTag = (typeof ENV_TABLE_TAGS_LIST)[number];

/** Consumption and volume tags, read per (device, channel), summed across phase. */
export const BASELINE_CHANNEL_ENERGY_TAGS = [
    'total_act_energy',
    'total_act_ret_energy',
    'volume_l',
    'volume_m3',
    'thermal_energy_kwh'
] as const satisfies readonly EnergyTableTag[];

/** The one device-grain tag; it must come from the device power SSOT function. */
export const BASELINE_POWER_TAG = 'power' as const satisfies EnergyTableTag;

/** Ambient sensor kinds. Chip temperature is excluded at read time by source. */
export const BASELINE_SENSOR_KINDS = [
    'temperature',
    'humidity',
    'co2',
    'luminance',
    'pressure',
    'moisture'
] as const satisfies readonly EnvTableTag[];

export const BASELINE_TAGS = [
    ...BASELINE_CHANNEL_ENERGY_TAGS,
    BASELINE_POWER_TAG,
    ...BASELINE_SENSOR_KINDS
] as const;

export type BaselineTag = (typeof BASELINE_TAGS)[number];

/** Which key a tag's baseline is stored under. Mirrors fm.fn_baseline_scope_type. */
export type BaselineScopeType = 'device' | 'device_channel';

export function baselineScopeType(tag: BaselineTag): BaselineScopeType {
    return tag === BASELINE_POWER_TAG ? 'device' : 'device_channel';
}

/** Physically valid range for a tag. null means physics does not pin it. */
export interface BaselineValueRange {
    min: number | null;
    max: number | null;
}

// Mirrors fm.fn_baseline_value_ok. Only physics that holds in every unit is
// encoded: the sensor rollup stores native units with no unit column, so a
// temperature or pressure clamp would silently delete Fahrenheit or Pa data.
export const BASELINE_VALUE_RANGES: Readonly<
    Record<BaselineTag, BaselineValueRange>
> = {
    // Deltas of monotonic counters; negative is impossible in any unit.
    total_act_energy: {min: 0, max: null},
    total_act_ret_energy: {min: 0, max: null},
    volume_l: {min: 0, max: null},
    volume_m3: {min: 0, max: null},
    thermal_energy_kwh: {min: 0, max: null},
    // An exporting site reads negative power; that is a correct reading.
    power: {min: null, max: null},
    // Percent in the only source that defines them (BTHome objects 3 and 20).
    humidity: {min: 0, max: 100},
    moisture: {min: 0, max: 100},
    // Native unit, no unit column, so no range.
    temperature: {min: null, max: null},
    pressure: {min: null, max: null},
    co2: {min: null, max: null},
    luminance: {min: null, max: null}
};

export function baselineValueOk(tag: BaselineTag, val: number): boolean {
    if (!Number.isFinite(val)) return false;
    const range = BASELINE_VALUE_RANGES[tag];
    if (range.min !== null && val < range.min) return false;
    if (range.max !== null && val > range.max) return false;
    return true;
}

/**
 * Temperature bands for the coarse temperature-adjusted baseline.
 *
 * Terciles of each window's OWN temperature series, never fixed thresholds.
 * The 15-min sensor rollup stores each sensor's native unit and has no unit
 * column, so a fixed Celsius cut point would silently misband every Fahrenheit
 * sensor, which is the bet BASELINE_VALUE_RANGES already refused to take.
 * Three bands, not six: a coarse weekday cell holds about 40 observations, so
 * three leave about 13 each and six would leave about 7.
 */
export const BASELINE_TEMP_BANDS = ['cool', 'mid', 'warm'] as const;
export type BaselineTempBand = (typeof BASELINE_TEMP_BANDS)[number];
