// Completeness of EM meter history without live rows: per channel the database
// stores every range with no minute record and no device gap, and every counter
// change the stored minutes do not explain. Each new range is raised here as a
// warning and a metric. Ranges are never filled or zeroed. callDb is injected.

import {getLogger} from 'log4js';
import * as Observability from './Observability';
import type {CounterName} from './observability/counters';

const logger = getLogger('emCompleteness');

export type CallDb = (method: string, params: unknown) => Promise<unknown>;

export type CompletenessKind = 'missing_records' | 'counter_mismatch';

/** One newly found range, as device_em.fn_em_completeness_check returns it. */
export interface CompletenessFinding {
    kind: CompletenessKind;
    tag: string;
    range_from: string;
    range_to: string;
    expected_wh: number | null;
    stored_wh: number | null;
}

export interface ChannelFinding extends CompletenessFinding {
    device: number;
    channel: number;
}

export interface EmCompletenessSettings {
    settleMs: number;
    maxSpanMs: number;
    counterLookbackMs: number;
    counterTolerancePct: number;
}

export interface EmCompletenessSweepDeps {
    callDb: CallDb;
    nowMs: number;
    settings: EmCompletenessSettings;
    incrementCounter?: (name: CounterName) => void;
    warn?: (finding: ChannelFinding) => void;
}

export interface EmCompletenessResult {
    channelsChecked: number;
    findings: number;
    failures: number;
}

interface MeterChannel {
    device: number;
    channel: number;
}

const FINDING_COUNTERS: Readonly<Record<CompletenessKind, CounterName>> = {
    missing_records: 'em_completeness_missing_ranges',
    counter_mismatch: 'em_completeness_counter_mismatches'
};

function defaultWarn(finding: ChannelFinding): void {
    logger.warn(
        'em history incomplete kind=%s device=%d channel=%d tag=%s from=%s to=%s expectedWh=%s storedWh=%s',
        finding.kind,
        finding.device,
        finding.channel,
        finding.tag,
        finding.range_from,
        finding.range_to,
        finding.expected_wh,
        finding.stored_wh
    );
}

function seconds(ms: number): string {
    return `${Math.floor(ms / 1000)} seconds`;
}

function rowsOf<T>(result: unknown): T[] {
    return ((result as {rows?: T[]} | null | undefined)?.rows ?? []) as T[];
}

async function listChannels(callDb: CallDb): Promise<MeterChannel[]> {
    const rows = rowsOf<MeterChannel>(
        await callDb('device_em.fn_em_completeness_channels', {})
    );
    return rows.map((r) => ({
        device: Number(r.device),
        channel: Number(r.channel)
    }));
}

async function checkChannel(
    target: MeterChannel,
    deps: EmCompletenessSweepDeps
): Promise<CompletenessFinding[]> {
    const {settings} = deps;
    return rowsOf<CompletenessFinding>(
        await deps.callDb('device_em.fn_em_completeness_check', {
            p_device: target.device,
            p_channel: target.channel,
            p_now: new Date(deps.nowMs).toISOString(),
            p_settle: seconds(settings.settleMs),
            p_max_span: seconds(settings.maxSpanMs),
            p_lookback: seconds(settings.counterLookbackMs),
            p_tolerance_pct: settings.counterTolerancePct
        })
    );
}

// A failing channel is counted and logged; the sweep goes on.
async function checkChannelIsolated(
    target: MeterChannel,
    deps: EmCompletenessSweepDeps
): Promise<CompletenessFinding[] | null> {
    try {
        return await checkChannel(target, deps);
    } catch (err) {
        (deps.incrementCounter ?? Observability.incrementCounter)(
            'em_completeness_check_failed'
        );
        logger.error(
            'em completeness check failed device=%d channel=%d: %s',
            target.device,
            target.channel,
            err instanceof Error ? err.message : String(err)
        );
        return null;
    }
}

function raise(finding: ChannelFinding, deps: EmCompletenessSweepDeps): void {
    (deps.incrementCounter ?? Observability.incrementCounter)(
        FINDING_COUNTERS[finding.kind]
    );
    (deps.warn ?? defaultWarn)(finding);
}

/** Channels whose record coverage one bootstrap call builds at most. */
export const COVERAGE_BOOTSTRAP_BATCH = 100;

// Builds the record coverage of channels that have none yet, one bounded
// transaction per call, until a call finds less than a full batch. A writer
// builds a channel itself when it reaches it first. Returns channels built.
export async function bootstrapEmCoverage(
    callDb: CallDb,
    batch = COVERAGE_BOOTSTRAP_BATCH
): Promise<number> {
    let total = 0;
    for (;;) {
        const [row] = rowsOf<{fn_em_coverage_bootstrap: number}>(
            await callDb('device_em.fn_em_coverage_bootstrap', {p_limit: batch})
        );
        const built = Number(row?.fn_em_coverage_bootstrap ?? 0);
        total += built;
        if (built < batch) return total;
    }
}

/** One pass over every meter channel with a sync bookmark. */
export async function sweepEmCompleteness(
    deps: EmCompletenessSweepDeps
): Promise<EmCompletenessResult> {
    const result: EmCompletenessResult = {
        channelsChecked: 0,
        findings: 0,
        failures: 0
    };
    for (const target of await listChannels(deps.callDb)) {
        const findings = await checkChannelIsolated(target, deps);
        if (findings === null) {
            result.failures++;
            continue;
        }
        result.channelsChecked++;
        for (const finding of findings) {
            result.findings++;
            raise({...finding, ...target}, deps);
        }
    }
    return result;
}
