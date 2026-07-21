import {buildTelemetryPatch} from './telemetry';
import type {ExpandedDeviceProfile, JsonObject} from './types';

const PHASES = ['a', 'b', 'c'] as const;

export interface SimulatedEnergyRow {
    externalId: string;
    ts: number;
    channel: number;
    phase: string;
    tag: string;
    domain: 'ac_mains';
    value: number;
}

function objectValue(value: unknown): JsonObject | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as JsonObject)
        : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : undefined;
}

function channelFromKey(key: string): number {
    const channel = Number(key.split(':')[1] ?? 0);
    return Number.isSafeInteger(channel) ? channel : 0;
}

function meterKeys(status: Readonly<Record<string, JsonObject>>): string[] {
    const keys = Object.keys(status);
    const em = keys.filter((key) => /^em:\d+$/.test(key));
    if (em.length > 0) return em;
    const em1 = keys.filter((key) => /^em1:\d+$/.test(key));
    if (em1.length > 0) return em1;
    return keys.filter((key) => {
        if (!/^(pm1|switch|light):\d+$/.test(key)) return false;
        return numberValue(status[key]?.apower) !== undefined;
    });
}

function appendMetrics(input: {
    rows: SimulatedEnergyRow[];
    profile: ExpandedDeviceProfile;
    ts: number;
    channel: number;
    phase: string;
    power: number | undefined;
    voltage: number | undefined;
    current: number | undefined;
    periodSeconds: number;
}): void {
    const metrics = [
        ['power', input.power],
        ['voltage', input.voltage],
        ['current', input.current],
        [
            input.power !== undefined && input.power < 0
                ? 'total_act_ret_energy'
                : 'total_act_energy',
            input.power === undefined
                ? undefined
                : (Math.abs(input.power) * input.periodSeconds) / 3600
        ]
    ] as const;
    for (const [tag, value] of metrics) {
        if (value === undefined) continue;
        input.rows.push({
            externalId: input.profile.shellyID,
            ts: input.ts,
            channel: input.channel,
            phase: input.phase,
            tag,
            domain: 'ac_mains',
            value: Number(value.toFixed(4))
        });
    }
}

export function energyRowsAt(input: {
    profile: ExpandedDeviceProfile;
    ts: number;
    periodSeconds: number;
}): SimulatedEnergyRow[] {
    const patch = buildTelemetryPatch({
        baseline: input.profile.status,
        status: input.profile.status,
        elapsedSeconds: input.periodSeconds,
        nowMs: input.ts * 1000
    });
    const rows: SimulatedEnergyRow[] = [];
    for (const key of meterKeys(input.profile.status)) {
        const namespace = key.split(':')[0];
        const channel = channelFromKey(key);
        const status = objectValue(patch[key]) ?? input.profile.status[key];
        if (namespace === 'em') {
            for (const phase of PHASES) {
                appendMetrics({
                    rows,
                    profile: input.profile,
                    ts: input.ts,
                    channel,
                    phase,
                    power: numberValue(status?.[`${phase}_act_power`]),
                    voltage: numberValue(status?.[`${phase}_voltage`]),
                    current: numberValue(status?.[`${phase}_current`]),
                    periodSeconds: input.periodSeconds
                });
            }
            continue;
        }
        appendMetrics({
            rows,
            profile: input.profile,
            ts: input.ts,
            channel,
            phase: 'z',
            power: numberValue(
                status?.[namespace === 'em1' ? 'act_power' : 'apower']
            ),
            voltage: numberValue(status?.voltage),
            current: numberValue(status?.current),
            periodSeconds: input.periodSeconds
        });
    }
    return rows;
}

export function* energyHistoryRows(input: {
    profiles: readonly ExpandedDeviceProfile[];
    fromTs: number;
    toTs: number;
    periodSeconds: number;
}): Generator<SimulatedEnergyRow> {
    for (let ts = input.fromTs; ts <= input.toTs; ts += input.periodSeconds) {
        for (const profile of input.profiles) {
            yield* energyRowsAt({
                profile,
                ts,
                periodSeconds: input.periodSeconds
            });
        }
    }
}

export function energyRowTsv(row: SimulatedEnergyRow): string {
    return [
        row.externalId,
        row.ts,
        row.channel,
        row.phase,
        row.tag,
        row.domain,
        row.value
    ].join('\t');
}
