// One meter record in the device's own key order -> raw em-sync stats rows.
// Pulled pages and pushed records both expand here, so a minute stores the
// same rows whichever way it arrived.

import log4js from 'log4js';
import type {EmStatsBatch} from '../emStatsQueue';
import * as Observability from '../Observability';

const logger = log4js.getLogger('message-parser');

export class EmSyncPeriodError extends Error {
    readonly code = 'EM_SYNC_PERIOD_INVALID';

    constructor() {
        super('EM_SYNC_PERIOD_INVALID');
        this.name = 'EmSyncPeriodError';
    }
}

export function parseEmSyncPeriod(value: unknown): number {
    if (typeof value !== 'number' && typeof value !== 'string') {
        throw new EmSyncPeriodError();
    }
    const period = Number(value);
    if (!Number.isInteger(period) || period <= 0 || period > 2_147_483_647) {
        throw new EmSyncPeriodError();
    }
    return period;
}

export type MeasurementField = {
    name: string;
    phase?: string;
    ref: string;
};

export type EmDataBlock = {
    period: number | string;
    ts: number;
    values: number[][];
};

export type EmRecordStatsRows = EmStatsBatch & {
    p_period: number[];
    p_source: string;
};

// Every per-phase record key -> its tag; averages reuse the live tags, extremes the min_/max_ tags.
const RECORD_KEY_TAGS: ReadonlyArray<readonly [string, string]> = [
    ['total_act_energy', 'total_act_energy'],
    ['fund_act_energy', 'fund_act_energy'],
    ['total_act_ret_energy', 'total_act_ret_energy'],
    ['fund_act_ret_energy', 'fund_act_ret_energy'],
    ['lag_react_energy', 'lag_react_energy'],
    ['lead_react_energy', 'lead_react_energy'],
    ['max_act_power', 'max_power'],
    ['min_act_power', 'min_power'],
    ['max_aprt_power', 'max_apparent_power'],
    ['min_aprt_power', 'min_apparent_power'],
    ['max_voltage', 'max_voltage'],
    ['min_voltage', 'min_voltage'],
    ['avg_voltage', 'voltage'],
    ['max_current', 'max_current'],
    ['min_current', 'min_current'],
    ['avg_current', 'current']
];

// Neutral-line keys carry no phase prefix; stored on phase 'z' like live n_current.
const DEVICE_RECORD_KEY_TAGS: ReadonlyArray<readonly [string, string]> = [
    ['n_max_current', 'max_neutral_current'],
    ['n_min_current', 'min_neutral_current'],
    ['n_avg_current', 'neutral_current']
];

export function measurementFields(phases?: string[]): MeasurementField[] {
    const perPhase = RECORD_KEY_TAGS.flatMap(([key, tag]) => {
        if (!phases) return [{name: key, ref: tag}];
        return phases.map((phase) => ({
            name: `${phase}_${key}`,
            phase,
            ref: tag
        }));
    });
    const deviceWide = DEVICE_RECORD_KEY_TAGS.map(([key, tag]) => ({
        name: key,
        ref: tag
    }));
    return [...perPhase, ...deviceWide];
}

// Whether a record with these keys yields any stored row.
export function hasStoredFields(input: {
    keys: readonly string[];
    phases?: string[];
}): boolean {
    return measurementFields(input.phases).some((f) =>
        input.keys.includes(f.name)
    );
}

// device_em.stats.val is REAL; a larger magnitude makes PostgreSQL reject the
// whole block, which the drainer then quarantines.
const EM_STATS_VALUE_LIMIT = 3.4028234663852886e38;

function isStorableEmValue(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= EM_STATS_VALUE_LIMIT
    );
}

type IndexedField = MeasurementField & {idx: number};

interface RecordEnergySource {
    phase?: string;
    actIdx: number;
    retIdx: number;
    reactive?: {lagIdx: number; leadIdx: number};
}

function fieldIndex(
    fields: readonly IndexedField[],
    wanted: {ref: string; phase?: string}
): number | undefined {
    return fields.find((f) => f.ref === wanted.ref && f.phase === wanted.phase)
        ?.idx;
}

// Per phase: both active energies, plus reactive energy when both its keys exist.
function recordEnergySources(
    fields: readonly IndexedField[]
): RecordEnergySource[] {
    return fields
        .filter((f) => f.ref === 'total_act_energy')
        .flatMap((act) => {
            const phase = act.phase;
            const retIdx = fieldIndex(fields, {
                ref: 'total_act_ret_energy',
                phase
            });
            if (retIdx === undefined) return [];
            const lagIdx = fieldIndex(fields, {ref: 'lag_react_energy', phase});
            const leadIdx = fieldIndex(fields, {
                ref: 'lead_react_energy',
                phase
            });
            const reactive =
                lagIdx !== undefined && leadIdx !== undefined
                    ? {lagIdx, leadIdx}
                    : undefined;
            return [{phase, actIdx: act.idx, retIdx, reactive}];
        });
}

export function averageActivePowerW(input: {
    actWh: unknown;
    retWh: unknown;
    periodS: number;
}): number | null {
    if (!isStorableEmValue(input.actWh) || !isStorableEmValue(input.retWh)) {
        return null;
    }
    const watts = ((input.actWh - input.retWh) * 3600) / input.periodS;
    return isStorableEmValue(watts) ? watts : null;
}

export interface RecordApparentValues {
    apparentVA: number;
    powerFactor: number | null;
}

// Utility billing ("vectorial"): S = |(net P, net Q)| energy, demand = S / period, pf = P / S.
export function recordApparentValues(input: {
    actWh: unknown;
    retWh: unknown;
    lagVarh: unknown;
    leadVarh: unknown;
    periodS: number;
}): RecordApparentValues | null {
    const energies = [input.actWh, input.retWh, input.lagVarh, input.leadVarh];
    if (!energies.every(isStorableEmValue)) return null;
    const [act, ret, lag, lead] = energies as number[];
    const activeWh = act - ret;
    const apparentVAh = Math.hypot(activeWh, lag - lead);
    const apparentVA = (apparentVAh * 3600) / input.periodS;
    if (!isStorableEmValue(apparentVA)) return null;
    return {
        apparentVA,
        powerFactor: apparentVAh > 0 ? activeWh / apparentVAh : null
    };
}

interface EmRecordRow {
    tag: string;
    phase?: string;
    ts: number;
    val: number;
    period: number;
}

function pushEmRecordRow(
    rows: EmRecordStatsRows,
    row: EmRecordRow & {device: number; channel: number}
): void {
    rows.p_device.push(row.device);
    rows.p_tag.push(row.tag);
    rows.p_domain.push('ac_mains');
    rows.p_phase.push(row.phase || 'z');
    rows.p_channel.push(row.channel);
    rows.p_ts.push(row.ts);
    rows.p_val.push(row.val);
    rows.p_period.push(row.period);
}

function reportOutOfRange(input: {
    device: number;
    channel: number;
    ts: number;
    field: string;
    value: unknown;
}): void {
    if (!Number.isFinite(input.value)) return;
    Observability.incrementCounter('em_sync_values_out_of_range');
    logger.warn(
        'em-sync value out of range device=%d channel=%d ts=%d field=%s',
        input.device,
        input.channel,
        input.ts,
        input.field
    );
}

// Rows of one device record: each mapped key, then the values derived from its energies.
function recordRows(input: {
    record: number[];
    ts: number;
    period: number;
    fields: readonly IndexedField[];
    energySources: readonly RecordEnergySource[];
    device: number;
    channel: number;
}): EmRecordRow[] {
    const out: EmRecordRow[] = [];
    for (const {idx, ref, phase} of input.fields) {
        const val = input.record[idx];
        if (!isStorableEmValue(val)) {
            reportOutOfRange({...input, field: ref, value: val});
            continue;
        }
        out.push({tag: ref, phase, ts: input.ts, val, period: input.period});
    }
    for (const source of input.energySources) {
        out.push(...derivedRecordRows({...input, source}));
    }
    return out;
}

// Power, apparent power and power factor come from the record's own energies.
function derivedRecordRows(input: {
    record: number[];
    ts: number;
    period: number;
    source: RecordEnergySource;
}): EmRecordRow[] {
    const {record, source} = input;
    const row = (tag: string, val: number): EmRecordRow => ({
        tag,
        phase: source.phase,
        ts: input.ts,
        val,
        period: input.period
    });
    const out: EmRecordRow[] = [];
    const watts = averageActivePowerW({
        actWh: record[source.actIdx],
        retWh: record[source.retIdx],
        periodS: input.period
    });
    if (watts !== null) out.push(row('power', watts));
    if (!source.reactive) return out;
    const apparent = recordApparentValues({
        actWh: record[source.actIdx],
        retWh: record[source.retIdx],
        lagVarh: record[source.reactive.lagIdx],
        leadVarh: record[source.reactive.leadIdx],
        periodS: input.period
    });
    if (!apparent) return out;
    out.push(row('apparent_power', apparent.apparentVA));
    if (apparent.powerFactor !== null) {
        out.push(row('power_factor', apparent.powerFactor));
    }
    return out;
}

// Build the raw-stats batch from an em-data payload: map each field to its
// column, drop values PostgreSQL cannot store, default a missing phase to 'z'.
export function buildEmStatsBatch(input: {
    fields: MeasurementField[];
    payload: {
        keys: string[];
        data: EmDataBlock[];
    };
    device: number;
    channel: number;
}): EmRecordStatsRows {
    const fields = input.fields
        .map((v) => ({...v, idx: input.payload.keys.indexOf(v.name)}))
        .filter((v) => v.idx > -1);
    const energySources = recordEnergySources(fields);
    const rows: EmRecordStatsRows = {
        p_device: [],
        p_tag: [],
        p_domain: [],
        p_phase: [],
        p_channel: [],
        p_ts: [],
        p_val: [],
        p_period: [],
        p_source: 'em_sync' // the 1-minute meter record — billing-grade
    };
    for (const {values, ts, period: reportedPeriod} of input.payload.data) {
        const period = parseEmSyncPeriod(reportedPeriod);
        // Record j covers [ts + j*period, ts + (j+1)*period). Stamping every
        // record with the block ts would collapse them onto one minute.
        for (let j = 0; j < values.length; j++) {
            for (const row of recordRows({
                record: values[j],
                ts: ts + j * period,
                period,
                fields,
                energySources,
                device: input.device,
                channel: input.channel
            })) {
                pushEmRecordRow(rows, {
                    ...row,
                    device: input.device,
                    channel: input.channel
                });
            }
        }
    }
    return rows;
}
