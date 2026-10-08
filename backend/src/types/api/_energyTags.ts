// Tag vocabularies for the Energy.* API contract. They live here in types/api
// so energy.ts stays self-contained: the contract is bundled into the frontend,
// which cannot resolve backend config. Backend config derives its membership
// sets and the API enum from these lists, so a tag is added in one place.

/** Tags that come from `device_em.stats` (vs the device_sensor rollup below). */
export const ENERGY_TABLE_TAGS_LIST = [
    'total_act_energy',
    'total_act_ret_energy',
    'volume_l',
    'volume_m3',
    // Explicit returned/injection counter only. No BTHome object or generic
    // volume-unit heuristic is allowed to infer this direction.
    'volume_returned_m3',
    'thermal_energy_kwh',
    'power',
    'volume_flow_m3h',
    'volume_storage_l',
    'voltage',
    'current',
    'min_voltage',
    'max_voltage',
    'min_current',
    'max_current',
    // The meter's own highest and lowest active power in each minute record.
    // min_/max_ tags: lowest of the lows, highest of the highs, never averaged.
    'max_power',
    'min_power',
    // The rest of the EM minute record. Energies are summed: fundamental
    // active (Wh) and lagging/leading reactive (VARh). Apparent power and
    // neutral current extremes follow the min_/max_ rule.
    'fund_act_energy',
    'fund_act_ret_energy',
    'lag_react_energy',
    'lead_react_energy',
    'max_apparent_power',
    'min_apparent_power',
    'max_neutral_current',
    'min_neutral_current',
    // Power-quality diagnostics from device_em.stats. Native units, divisor 1.
    // total_* are firmware device-totals (phase 'z'); the plain tags are
    // per-phase and read back as a phase average.
    'apparent_power',
    'power_factor',
    'frequency',
    'total_power',
    'total_apparent_power',
    'total_current',
    'neutral_current',
    // Battery-monitor (bm) DC telemetry — domain dc_battery in device_em.stats.
    // soc/soh are %, cycles a count, charge_ah/discharge_ah Amp-hours (divisor 1).
    'soc',
    'soh',
    'cycles',
    'charge_ah',
    'discharge_ah'
] as const;

/**
 * Tags read from the device_sensor rollup (`device_sensor.numeric_15min`,
 * via `fn_numeric_history`). 'distance' is millimetres (the metre object is
 * skipped at capture). Excludes 'wind_speed'/'wind_gust': they share one BTHome
 * object ('speed', obj_id 68/98) told apart only by channel, which
 * fn_numeric_history does not group by, so they cannot be separated at this read
 * layer yet — deferred, not wired to a misleading mixed average.
 */
export const ENV_TABLE_TAGS_LIST = [
    'temperature',
    'humidity',
    'luminance',
    'pressure',
    'dewpoint',
    'co2',
    'tvoc',
    'pm25',
    'pm10',
    'moisture',
    'uv',
    'conductivity',
    'wind_direction',
    'precipitation',
    'battery',
    'distance'
] as const;
