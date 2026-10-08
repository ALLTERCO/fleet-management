// Push buffer entry format: one meter record per entry, in the device's own
// format. The value array is stored as the device sent it; the key list is a
// content reference to one copy shared by every meter with that list.

import {createHash} from 'node:crypto';
import {type EmDataBlock, parseEmSyncPeriod} from './emRecordRows';

const RECORD_FIELD = 'record';
const KEYSET_FIELD = 'keyset';
// 96 bits of SHA-256: a collision among a fleet's few key lists is not a risk.
const KEYSET_ID_HEX = 24;

export interface EmSyncRecordPush {
    device: number;
    channel: number;
    phases?: string[];
    keys: string[];
    blocks: EmDataBlock[];
}

export interface EmSyncRecordEntries {
    keyset: {id: string; value: string};
    entries: Array<Record<string, string>>;
}

export interface EmSyncRecord {
    device: number;
    channel: number;
    phases?: string[];
    keyset: string;
    ts: number;
    period: number;
    values: unknown[];
}

interface WireRecord {
    d: number;
    c: number;
    ph?: string[];
    ts: number;
    p: number;
    v: unknown[];
}

export function emSyncKeysetId(keys: readonly string[]): string {
    return createHash('sha256')
        .update(JSON.stringify(keys))
        .digest('hex')
        .slice(0, KEYSET_ID_HEX);
}

export function encodeEmSyncRecordPush(
    push: EmSyncRecordPush
): EmSyncRecordEntries {
    const keyset = {
        id: emSyncKeysetId(push.keys),
        value: JSON.stringify(push.keys)
    };
    const entries = push.blocks.flatMap((block) => {
        const period = parseEmSyncPeriod(block.period);
        return block.values.map((values, j) => ({
            [RECORD_FIELD]: JSON.stringify(
                wireRecord(push, {ts: block.ts + j * period, period, values})
            ),
            [KEYSET_FIELD]: keyset.id
        }));
    });
    return {keyset, entries};
}

function wireRecord(
    push: EmSyncRecordPush,
    record: {ts: number; period: number; values: number[]}
): WireRecord {
    return {
        d: push.device,
        c: push.channel,
        ...(push.phases ? {ph: push.phases} : {}),
        ts: record.ts,
        p: record.period,
        v: record.values
    };
}

export function isEmSyncRecordEntry(fields: Record<string, string>): boolean {
    return typeof fields[RECORD_FIELD] === 'string';
}

export function emSyncRecordKeyset(
    fields: Record<string, string>
): string | null {
    const id = fields[KEYSET_FIELD];
    return typeof id === 'string' && id.length > 0 ? id : null;
}

// null when the entry is not a valid record: it cannot be expanded.
export function decodeEmSyncRecordEntry(
    fields: Record<string, string>
): EmSyncRecord | null {
    const keyset = emSyncRecordKeyset(fields);
    const wire = parseWire(fields[RECORD_FIELD]);
    if (!keyset || !wire) return null;
    return {
        device: wire.d,
        channel: wire.c,
        ...(wire.ph ? {phases: wire.ph} : {}),
        keyset,
        ts: wire.ts,
        period: wire.p,
        values: wire.v
    };
}

function parseWire(raw: string | undefined): WireRecord | null {
    if (typeof raw !== 'string') return null;
    const value = parseJson(raw);
    return isWireRecord(value) ? value : null;
}

// Invalid JSON parses to undefined, which no shape check accepts.
function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw);
    } catch {
        return undefined;
    }
}

function isWireRecord(value: unknown): value is WireRecord {
    if (typeof value !== 'object' || value === null) return false;
    const w = value as Partial<WireRecord>;
    return (
        Number.isSafeInteger(w.d) &&
        (w.d as number) > 0 &&
        Number.isSafeInteger(w.c) &&
        (w.c as number) >= 0 &&
        Number.isSafeInteger(w.ts) &&
        (w.ts as number) >= 0 &&
        Number.isSafeInteger(w.p) &&
        (w.p as number) > 0 &&
        Array.isArray(w.v) &&
        (w.ph === undefined ||
            (Array.isArray(w.ph) && w.ph.every((p) => typeof p === 'string')))
    );
}

// A key list read back from the shared hash; null when it is not one.
export function parseEmSyncKeyset(raw: string | null): string[] | null {
    if (raw === null) return null;
    const value = parseJson(raw);
    return Array.isArray(value) && value.every((k) => typeof k === 'string')
        ? value
        : null;
}
