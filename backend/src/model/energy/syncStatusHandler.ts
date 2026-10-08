import {
    EM_DEVICE_HISTORY_SECONDS,
    EM_SYNC_CURRENT_LAG_SECONDS
} from '../../config/energy';
import type {
    EmSyncStatusRow,
    EnergyRepository
} from '../../modules/repositories/EnergyRepository';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    ENERGY_SYNC_STATUS_PARAMS_SCHEMA,
    type EnergySyncDeviceStatus,
    type EnergySyncStatusParams,
    type EnergySyncStatusResponse
} from '../../types/api/energy';
import {resolveScope, type SenderCapabilities} from './queryHandler';

export type EnergySyncDeviceSnapshot = {status?: Record<string, unknown>};
export type EnergySyncDeviceLookup = (
    shellyID: string
) => EnergySyncDeviceSnapshot | undefined;

function emChannels(device: EnergySyncDeviceSnapshot | undefined): number[] {
    if (!device?.status) return [];
    const channels = new Set<number>();
    for (const key of Object.keys(device.status)) {
        const match = /^(?:em1|em):(\d+)$/.exec(key);
        if (match) channels.add(Number(match[1]));
    }
    return [...channels].sort((a, b) => a - b);
}

function rowKey(device: number, channel: number): string {
    return `${device}:${channel}`;
}

function finiteNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

// A reader takes 100.0% as "finished", so anything with work outstanding stops
// here: one decimal of rounding hides days of a 60-day history.
const WORK_LEFT_MAX_PCT = 99.9;

function reportedProgressPct(pct: number, workLeft: boolean): number {
    const rounded = Number(pct.toFixed(1));
    return workLeft ? Math.min(rounded, WORK_LEFT_MAX_PCT) : rounded;
}

export function buildEnergySyncStatus(input: {
    channels: readonly {
        device: number;
        shellyID: string;
        channel: number;
    }[];
    rows: readonly EmSyncStatusRow[];
    nowS: number;
}): EnergySyncStatusResponse {
    const byChannel = new Map(
        input.rows.map((row) => [
            rowKey(Number(row.device), Number(row.channel)),
            row
        ])
    );
    let historyRemainingSeconds = 0;
    let rollupPendingBuckets = 0;
    let rollupScheduledBuckets = 0;
    let oldestRollupAgeSeconds = 0;
    const catchingUpDevices = new Set<number>();
    let channelsCatchingUp = 0;
    let totalLagSeconds = 0;

    const devices: EnergySyncDeviceStatus[] = input.channels.map((channel) => {
        const row = byChannel.get(rowKey(channel.device, channel.channel));
        const rawCursor =
            row?.sync_created === null || row?.sync_created === undefined
                ? input.nowS - EM_DEVICE_HISTORY_SECONDS
                : finiteNumber(row.sync_created);
        const cursor = Math.min(input.nowS, rawCursor);
        const lagSeconds = Math.min(
            EM_DEVICE_HISTORY_SECONDS,
            Math.max(0, input.nowS - cursor)
        );
        const pending = Math.max(0, finiteNumber(row?.rollup_pending));
        const scheduled = Math.max(0, finiteNumber(row?.rollup_scheduled));
        totalLagSeconds += lagSeconds;
        const progressPct =
            ((EM_DEVICE_HISTORY_SECONDS - lagSeconds) /
                EM_DEVICE_HISTORY_SECONDS) *
            100;
        const channelCatchingUp = lagSeconds > EM_SYNC_CURRENT_LAG_SECONDS;
        if (channelCatchingUp) {
            channelsCatchingUp++;
            catchingUpDevices.add(channel.device);
            historyRemainingSeconds += lagSeconds;
        }
        rollupPendingBuckets += pending;
        rollupScheduledBuckets += scheduled;
        if (row?.oldest_rollup_dirty) {
            const dirtyMs = new Date(row.oldest_rollup_dirty).getTime();
            if (Number.isFinite(dirtyMs)) {
                oldestRollupAgeSeconds = Math.max(
                    oldestRollupAgeSeconds,
                    Math.max(0, input.nowS - dirtyMs / 1000)
                );
            }
        }
        return {
            ...channel,
            syncedThrough:
                row?.sync_created === null || row?.sync_created === undefined
                    ? null
                    : new Date(cursor * 1000).toISOString(),
            lagSeconds: Math.round(lagSeconds),
            progressPct: reportedProgressPct(
                progressPct,
                channelCatchingUp || pending > 0
            ),
            rollupPendingBuckets: pending,
            rollupScheduledBuckets: scheduled
        };
    });
    const progressPct =
        devices.length === 0
            ? 100
            : ((devices.length * EM_DEVICE_HISTORY_SECONDS - totalLagSeconds) /
                  (devices.length * EM_DEVICE_HISTORY_SECONDS)) *
              100;

    // One rule for both numbers, so the percentage can never disagree with the
    // flag a caller reads as "finished". Scheduled buckets wait for their
    // period to close: provisional, not unfinished work.
    const complete = channelsCatchingUp === 0 && rollupPendingBuckets === 0;

    return {
        asOf: new Date(input.nowS * 1000).toISOString(),
        complete,
        progressPct: reportedProgressPct(progressPct, !complete),
        devicesTotal: new Set(devices.map((item) => item.device)).size,
        devicesCatchingUp: catchingUpDevices.size,
        channelsCatchingUp,
        historyRemainingSeconds: Math.round(historyRemainingSeconds),
        rollupPendingBuckets,
        rollupScheduledBuckets,
        provisional: rollupScheduledBuckets > 0,
        oldestRollupAgeSeconds: Math.round(oldestRollupAgeSeconds),
        devices
    };
}

export async function handleEnergySyncStatus(
    params: unknown,
    sender: SenderCapabilities,
    repo: EnergyRepository,
    lookup: EnergySyncDeviceLookup,
    nowS = Math.floor(Date.now() / 1000)
): Promise<EnergySyncStatusResponse> {
    const validated = validateOrThrow<EnergySyncStatusParams>(
        params,
        ENERGY_SYNC_STATUS_PARAMS_SCHEMA
    );
    if (validated.scope !== undefined && validated.devices !== undefined) {
        throw RpcError.InvalidParams(
            'scope and devices are mutually exclusive'
        );
    }
    const resolved = await resolveScope(sender, validated, repo);
    return loadEnergySyncStatus({
        internalIds: resolved.internalIds,
        idMap: resolved.idMap,
        repo,
        lookup,
        nowS
    });
}

export async function loadEnergySyncStatus(input: {
    internalIds: readonly number[];
    idMap: Readonly<Record<number, string>>;
    repo: EnergyRepository;
    lookup: EnergySyncDeviceLookup;
    nowS?: number;
}): Promise<EnergySyncStatusResponse> {
    const channels = input.internalIds.flatMap((device) => {
        const shellyID = input.idMap[device];
        return emChannels(input.lookup(shellyID)).map((channel) => ({
            device,
            shellyID,
            channel
        }));
    });
    const rows = await input.repo.queryEmSyncStatus(channels);
    return buildEnergySyncStatus({
        channels,
        rows,
        nowS: input.nowS ?? Math.floor(Date.now() / 1000)
    });
}
