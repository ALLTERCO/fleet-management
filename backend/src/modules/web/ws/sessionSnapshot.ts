// Shutdown snapshot of WS session metadata so the next process can
// pre-seed cached state (avoids re-pulling everything from PG on boot).

import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    unlinkSync,
    writeFileSync
} from 'node:fs';
import {dirname} from 'node:path';
import log4js from 'log4js';

const logger = log4js.getLogger('session-snapshot');

const SCHEMA_VERSION = 1;

export interface SessionRecord {
    userId: number | string;
    connectionId: string;
    deviceIds: ReadonlyArray<string>;
    eventTypes?: ReadonlyArray<string>;
}

export interface SessionSnapshot {
    version: number;
    capturedAtMs: number;
    sessions: ReadonlyArray<SessionRecord>;
}

export function buildSnapshot(
    sessions: Iterable<SessionRecord>
): SessionSnapshot {
    return {
        version: SCHEMA_VERSION,
        capturedAtMs: Date.now(),
        sessions: Array.from(sessions)
    };
}

export function writeSnapshot(path: string, snapshot: SessionSnapshot): void {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
    writeFileSync(path, JSON.stringify(snapshot), {mode: 0o600});
    // mode on writeFileSync only applies at create — enforce on overwrite too.
    chmodSync(path, 0o600);
    logger.info(
        'snapshot written path=%s sessions=%d',
        path,
        snapshot.sessions.length
    );
}

export function readSnapshot(path: string): SessionSnapshot | null {
    if (!existsSync(path)) return null;
    try {
        const raw = readFileSync(path, 'utf8');
        return parseSnapshot(raw);
    } catch (err) {
        logger.warn('snapshot read failed path=%s: %s', path, err);
        return null;
    }
}

// Read + delete so a crash-loop doesn't replay the same snapshot every boot.
export function consumeSnapshot(path: string): SessionSnapshot | null {
    const snap = readSnapshot(path);
    if (existsSync(path)) {
        try {
            unlinkSync(path);
        } catch (err) {
            logger.warn('snapshot unlink failed path=%s: %s', path, err);
        }
    }
    return snap;
}

export function parseSnapshot(raw: string): SessionSnapshot | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!isSnapshot(parsed)) return null;
    if (parsed.version !== SCHEMA_VERSION) return null;
    return parsed;
}

function isSnapshot(value: unknown): value is SessionSnapshot {
    if (typeof value !== 'object' || value === null) return false;
    const s = value as Partial<SessionSnapshot>;
    return (
        typeof s.version === 'number' &&
        typeof s.capturedAtMs === 'number' &&
        Array.isArray(s.sessions) &&
        s.sessions.every(isSessionRecord)
    );
}

function isSessionRecord(value: unknown): value is SessionRecord {
    if (typeof value !== 'object' || value === null) return false;
    const r = value as Partial<SessionRecord>;
    if (typeof r.userId !== 'number' && typeof r.userId !== 'string') {
        return false;
    }
    if (typeof r.connectionId !== 'string') return false;
    if (!Array.isArray(r.deviceIds)) return false;
    if (!r.deviceIds.every((d) => typeof d === 'string')) return false;
    if (r.eventTypes !== undefined) {
        if (!Array.isArray(r.eventTypes)) return false;
        if (!r.eventTypes.every((e) => typeof e === 'string')) return false;
    }
    return true;
}
