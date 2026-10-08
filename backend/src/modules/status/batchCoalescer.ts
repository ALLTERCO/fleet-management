// Concatenates multiple status_push_queue payloads into a single PG batch.

import type {StreamEntry} from '../redis/RedisStream';
import {toEpochSeconds} from '../util/epochSeconds';

export interface StatusBatch {
    p_ts: number[];
    p_id: number[];
    p_field: string[];
    p_field_group: string[];
    p_value: number[];
    p_prev_value: number[];
}

export interface StatusSourceDevice {
    deviceListId: number;
    externalId: string;
    organizationId: string;
}

export interface CoalescedBatch {
    batch: StatusBatch;
    sourceIds: string[];
    sourceDevices: StatusSourceDevice[];
    legacySourceMetadata: boolean;
}

export interface CoalesceResult {
    batches: CoalescedBatch[];
    poisonIds: string[];
}

export function statusBatchTimestampToIso(seconds: number): string | null {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

const COLUMN_KEYS: ReadonlyArray<keyof StatusBatch> = [
    'p_ts',
    'p_id',
    'p_field',
    'p_field_group',
    'p_value',
    'p_prev_value'
];

export function coalesceStatusBatches(
    entries: ReadonlyArray<StreamEntry>,
    maxRows: number
): CoalesceResult {
    if (entries.length === 0) return {batches: [], poisonIds: []};
    const batches: CoalescedBatch[] = [];
    const poisonIds: string[] = [];
    let current = emptyBatch();
    let currentIds: string[] = [];
    let currentSources = new Map<number, StatusSourceDevice>();
    let conflictingSourceIds = new Set<number>();
    let legacySourceMetadata = false;
    for (const entry of entries) {
        const parsed = parseEntry(entry);
        if (parsed === null) {
            poisonIds.push(entry.id);
            continue;
        }
        if (current.p_ts.length + parsed.batch.p_ts.length > maxRows) {
            if (current.p_ts.length > 0) {
                batches.push({
                    batch: current,
                    sourceIds: currentIds,
                    sourceDevices: [...currentSources.values()],
                    legacySourceMetadata
                });
                current = emptyBatch();
                currentIds = [];
                currentSources = new Map();
                conflictingSourceIds = new Set();
                legacySourceMetadata = false;
            }
        }
        appendBatch(current, parsed.batch);
        legacySourceMetadata ||=
            mergeSources(
                currentSources,
                conflictingSourceIds,
                parsed.sourceDevices
            ) > 0;
        legacySourceMetadata ||= parsed.legacySourceMetadata;
        currentIds.push(entry.id);
    }
    if (current.p_ts.length > 0) {
        batches.push({
            batch: current,
            sourceIds: currentIds,
            sourceDevices: [...currentSources.values()],
            legacySourceMetadata
        });
    }
    return {batches, poisonIds};
}

function emptyBatch(): StatusBatch {
    return {
        p_ts: [],
        p_id: [],
        p_field: [],
        p_field_group: [],
        p_value: [],
        p_prev_value: []
    };
}

interface ParsedStatusEntry {
    batch: StatusBatch;
    sourceDevices: StatusSourceDevice[];
    legacySourceMetadata: boolean;
}

function parseEntry(entry: StreamEntry): ParsedStatusEntry | null {
    const raw = entry.fields.batch;
    if (typeof raw !== 'string') return null;
    try {
        const obj = JSON.parse(raw);
        if (!isStatusBatch(obj)) return null;
        const sourceDevices = parseSourceDevices(entry.fields.sourceDevices);
        return {
            batch: {
                ...obj,
                p_ts: obj.p_ts.map((seconds) => toEpochSeconds(seconds, 0))
            },
            sourceDevices: sourceDevices ?? [],
            legacySourceMetadata: sourceDevices === null
        };
    } catch {
        return null;
    }
}

function parseSourceDevices(
    raw: string | undefined
): StatusSourceDevice[] | null {
    if (raw === undefined) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed) || !parsed.every(isStatusSourceDevice)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function isStatusSourceDevice(value: unknown): value is StatusSourceDevice {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const source = value as Partial<StatusSourceDevice>;
    return (
        Number.isInteger(source.deviceListId) &&
        typeof source.externalId === 'string' &&
        source.externalId.length > 0 &&
        typeof source.organizationId === 'string' &&
        source.organizationId.length > 0
    );
}

function mergeSources(
    target: Map<number, StatusSourceDevice>,
    conflicts: Set<number>,
    sources: readonly StatusSourceDevice[]
): number {
    let conflictCount = 0;
    for (const source of sources) {
        if (conflicts.has(source.deviceListId)) continue;
        const current = target.get(source.deviceListId);
        if (
            current &&
            (current.externalId !== source.externalId ||
                current.organizationId !== source.organizationId)
        ) {
            // A device-list identity is immutable. Conflicting stream metadata
            // is not trusted; remove it so the bounded PostgreSQL compatibility
            // resolver restores the authoritative identity without dropping the
            // status rows.
            target.delete(source.deviceListId);
            conflicts.add(source.deviceListId);
            conflictCount++;
            continue;
        }
        target.set(source.deviceListId, source);
    }
    return conflictCount;
}

function appendBatch(into: StatusBatch, from: StatusBatch): void {
    for (const key of COLUMN_KEYS) {
        const target = into[key] as unknown as unknown[];
        const source = from[key] as unknown as unknown[];
        for (const v of source) target.push(v);
    }
}

function isStatusBatch(value: unknown): value is StatusBatch {
    if (typeof value !== 'object' || value === null) return false;
    const b = value as Partial<StatusBatch>;
    const timestamps = b.p_ts;
    if (!Array.isArray(timestamps)) return false;
    const len = timestamps.length;
    for (const key of COLUMN_KEYS) {
        const arr = b[key];
        if (!Array.isArray(arr) || arr.length !== len) return false;
    }
    return timestamps.every(
        (seconds) => typeof seconds === 'number' && Number.isFinite(seconds)
    );
}
