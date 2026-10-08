/**
 * Domain data constants for energy / metrics queries.
 *
 * Phase 0b creates this module alongside `config/BTHomeData.ts` and
 * `config/shelly.dataTypes.ts` — domain-specific data that multiple
 * components will reference once Phase 1 extracts EnergyComponent.
 *
 * FleetManagerComponent keeps a copy of these for now (REPORT_TYPES,
 * GRANULARITY_MAP). Phase 1 replaces those copies with imports from here.
 */

import {
    ENERGY_TABLE_TAGS_LIST,
    ENV_TABLE_TAGS_LIST
} from '../types/api/_energyTags';

/** History retained by Shelly EM devices: 60 days of one-minute records. */
export const EM_DEVICE_HISTORY_SECONDS = 60 * 24 * 60 * 60;
/** A bookmark inside the normal ten-minute cadence is considered current. */
export const EM_SYNC_CURRENT_LAG_SECONDS = 10 * 60;

export interface MetricDefinition {
    /** Raw tags in `device_em.stats` that back this metric */
    tags: string[];
    /** Column renames applied when shaping the response */
    columns: Record<string, string>;
    /** Human-readable unit */
    unit: string;
    /** Divisor applied to the raw DB value (e.g. 1000 for Wh → kWh) */
    divisor: number;
    /** Decimal precision for display */
    precision: number;
}

/**
 * Metric types used by Energy.Query and report generation. Matches the
 * shape in FleetManagerComponent exactly — Phase 1 will fold the FM copy
 * into imports from here.
 */
export const METRIC_TYPES: Record<string, MetricDefinition> = {
    consumption: {
        tags: ['total_act_energy'],
        columns: {total_act_energy: 'energy_kwh'},
        unit: 'kWh',
        divisor: 1000,
        precision: 3
    },
    returned_energy: {
        tags: ['total_act_ret_energy'],
        columns: {total_act_ret_energy: 'returned_energy_kwh'},
        unit: 'kWh',
        divisor: 1000,
        precision: 3
    },
    volume: {
        tags: [
            'volume_l',
            'volume_m3',
            'volume_returned_m3',
            'volume_storage_l'
        ],
        columns: {
            volume_l: 'volume_l',
            volume_m3: 'volume_m3',
            volume_returned_m3: 'volume_returned_m3',
            volume_storage_l: 'volume_storage_l'
        },
        unit: 'volume',
        divisor: 1,
        precision: 3
    },
    thermal_energy: {
        tags: ['thermal_energy_kwh'],
        columns: {thermal_energy_kwh: 'thermal_energy_kwh'},
        unit: 'kWh',
        divisor: 1,
        precision: 3
    },
    volume_flow: {
        tags: ['volume_flow_m3h'],
        columns: {volume_flow_m3h: 'volume_flow_m3h'},
        unit: 'm3/h',
        divisor: 1,
        precision: 3
    },
    voltage: {
        tags: ['voltage', 'min_voltage', 'max_voltage'],
        columns: {
            voltage: 'avg_voltage_v',
            min_voltage: 'min_voltage_v',
            max_voltage: 'max_voltage_v'
        },
        unit: 'V',
        divisor: 1,
        precision: 2
    },
    current: {
        tags: ['current', 'min_current', 'max_current'],
        columns: {
            current: 'avg_current_a',
            min_current: 'min_current_a',
            max_current: 'max_current_a'
        },
        unit: 'A',
        divisor: 1,
        precision: 3
    },
    power: {
        tags: ['power'],
        columns: {power: 'avg_power_w'},
        unit: 'W',
        divisor: 1,
        precision: 1
    },
    // EM meter record values. Apparent power and power factor are derived per
    // minute record from its active and reactive energy.
    reactive_energy: {
        tags: ['lag_react_energy', 'lead_react_energy'],
        columns: {
            lag_react_energy: 'lagging_reactive_kvarh',
            lead_react_energy: 'leading_reactive_kvarh'
        },
        unit: 'kvarh',
        divisor: 1000,
        precision: 3
    },
    fundamental_energy: {
        tags: ['fund_act_energy', 'fund_act_ret_energy'],
        columns: {
            fund_act_energy: 'fundamental_energy_kwh',
            fund_act_ret_energy: 'fundamental_returned_energy_kwh'
        },
        unit: 'kWh',
        divisor: 1000,
        precision: 3
    },
    apparent_power: {
        tags: ['apparent_power', 'min_apparent_power', 'max_apparent_power'],
        columns: {
            apparent_power: 'avg_apparent_power_va',
            min_apparent_power: 'min_apparent_power_va',
            max_apparent_power: 'max_apparent_power_va'
        },
        unit: 'VA',
        divisor: 1,
        precision: 1
    },
    power_factor: {
        tags: ['power_factor'],
        columns: {power_factor: 'avg_power_factor'},
        unit: '',
        divisor: 1,
        precision: 3
    },
    neutral_current: {
        tags: ['neutral_current', 'min_neutral_current', 'max_neutral_current'],
        columns: {
            neutral_current: 'avg_neutral_current_a',
            min_neutral_current: 'min_neutral_current_a',
            max_neutral_current: 'max_neutral_current_a'
        },
        unit: 'A',
        divisor: 1,
        precision: 3
    }
};

/**
 * Granularity → TimescaleDB `time_bucket` interval mapping.
 * Callers that take user input MUST validate against this allowlist before
 * passing the bucket string to a DB function (per the security fix that
 * landed with the Phase 0a bucket allowlist in DeviceComponent).
 */
export const GRANULARITY_MAP: Record<string, string> = {
    minute: '1 minute',
    five_minutes: '5 minutes',
    fifteen_minutes: '15 minutes',
    thirty_minutes: '30 minutes',
    hour: '1 hour',
    six_hours: '6 hours',
    twelve_hours: '12 hours',
    day: '1 day',
    week: '1 week',
    month: '1 month'
};

/** Allowed bucket strings — the set of values in GRANULARITY_MAP */
export const VALID_BUCKETS: ReadonlySet<string> = new Set(
    Object.values(GRANULARITY_MAP)
);

/**
 * Environmental-metric tag → `device_sensor.numeric_15min.kind` value.
 * Used by the rollup read path (`device_sensor.fn_numeric_history`). Mostly
 * identity — 'wind_direction' maps to stored kind 'direction', 'luminance' to
 * 'illuminance'.
 * Electrical readings (voltage/current/power/energy) are NOT here — they belong
 * to the energy pipeline (ENERGY_TABLE_TAGS).
 */
export const ENV_ROLLUP_FIELD: Record<string, string> = {
    temperature: 'temperature',
    humidity: 'humidity',
    luminance: 'illuminance',
    pressure: 'pressure',
    dewpoint: 'dewpoint',
    co2: 'co2',
    tvoc: 'tvoc',
    pm25: 'pm25',
    pm10: 'pm10',
    moisture: 'moisture',
    uv: 'uv',
    conductivity: 'conductivity',
    // BTHome object name is 'direction' (obj_id 94) — no 'wind_direction' kind exists.
    wind_direction: 'direction',
    precipitation: 'precipitation',
    battery: 'battery',
    // Millimetres, stored as kind 'distance' (the metre object is skipped).
    distance: 'distance'
};

// The tag lists are the single source of truth in the API contract
// (types/api/_energyTags), so energy.ts stays self-contained. Re-exported here
// for existing callers; the membership sets below derive from them.
export {ENERGY_TABLE_TAGS_LIST, ENV_TABLE_TAGS_LIST};
export const ENERGY_TABLE_TAGS: ReadonlySet<string> = new Set(
    ENERGY_TABLE_TAGS_LIST
);
export const ENV_TABLE_TAGS: ReadonlySet<string> = new Set(ENV_TABLE_TAGS_LIST);

/**
 * Bucket intervals finer than 15 min. These must read raw `device_em.stats`
 * (which keeps a 1-month hot window) — the 15-minute rollup cannot produce
 * finer detail. Everything 15 min and coarser reads the rollup, which holds
 * long-term history and re-buckets up.
 */
export const RAW_ONLY_BUCKETS: ReadonlySet<string> = new Set([
    '1 minute',
    '5 minutes'
]);

/**
 * Route decision for an energy bucket interval: true → read the 15-minute
 * rollup (`device_em.fn_report_stats_rollup*`); false → read raw
 * (`device_em.fn_report_stats*`). Input is a validated interval string from
 * `ENERGY_BUCKETS` / `GRANULARITY_MAP`.
 */
export function bucketUsesRollup(bucket: string): boolean {
    return !RAW_ONLY_BUCKETS.has(bucket);
}

/**
 * Classify a set of tags into the two data sources. Energy.Query uses this
 * to decide whether to hit one table, the other, or both in parallel.
 */
export function classifyTags(tags: readonly string[]): {
    energyTags: string[];
    envTags: string[];
    unknownTags: string[];
} {
    const energyTags: string[] = [];
    const envTags: string[] = [];
    const unknownTags: string[] = [];
    for (const tag of tags) {
        if (ENERGY_TABLE_TAGS.has(tag)) energyTags.push(tag);
        else if (ENV_TABLE_TAGS.has(tag)) envTags.push(tag);
        else unknownTags.push(tag);
    }
    return {energyTags, envTags, unknownTags};
}
