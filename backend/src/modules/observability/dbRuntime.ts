import fs from 'node:fs';
import {deployManifestPath} from '../controlPlaneContract';

export type DbRuntimeStatus = 'unknown' | 'ok' | 'stale' | 'mismatch' | 'error';

export interface DbRuntimeSnapshot {
    status: DbRuntimeStatus;
    statusCode: number;
    checkedAt: string;
    checkedAtMs: number;
    checkAgeSeconds: number;
    lastSuccessfulAt: string;
    lastSuccessfulAtMs: number;
    lastSuccessfulAgeSeconds: number;
    postgresVersion: string;
    postgresMajor: number;
    timescaleVersion: string;
    expectedTimescaleImage: string;
    expectedTimescaleVersion: string;
    error: string;
}

const UNKNOWN: DbRuntimeSnapshot = {
    status: 'unknown',
    statusCode: 0,
    checkedAt: '',
    checkedAtMs: 0,
    checkAgeSeconds: -1,
    lastSuccessfulAt: '',
    lastSuccessfulAtMs: 0,
    lastSuccessfulAgeSeconds: -1,
    postgresVersion: '',
    postgresMajor: -1,
    timescaleVersion: '',
    expectedTimescaleImage: '',
    expectedTimescaleVersion: '',
    error: ''
};

let snapshot: DbRuntimeSnapshot = UNKNOWN;

export function dbRuntimeStatusCode(status: DbRuntimeStatus): number {
    switch (status) {
        case 'ok':
            return 1;
        case 'stale':
            return 2;
        case 'mismatch':
            return 3;
        case 'error':
            return 4;
        default:
            return 0;
    }
}

export function postgresMajorFromVersion(version: string): number {
    const m = version.match(/^(\d+)/);
    return m ? Number(m[1]) : -1;
}

export function timescaleVersionFromImage(image: string): string {
    const tag = image.includes(':') ? image.split(':').pop() || '' : image;
    const m = tag.match(/^(\d+\.\d+\.\d+)/);
    return m?.[1] ?? '';
}

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map((v) => Number.parseInt(v, 10));
    const pb = b.split('.').map((v) => Number.parseInt(v, 10));
    for (let i = 0; i < 3; i++) {
        const av = Number.isFinite(pa[i]) ? pa[i] : 0;
        const bv = Number.isFinite(pb[i]) ? pb[i] : 0;
        if (av !== bv) return av < bv ? -1 : 1;
    }
    return 0;
}

export function compareTimescaleRuntime(
    actualVersion: string,
    expectedVersion: string
): DbRuntimeStatus {
    if (!actualVersion || !expectedVersion) return 'unknown';
    const cmp = compareSemver(actualVersion, expectedVersion);
    if (cmp === 0) return 'ok';
    return cmp < 0 ? 'stale' : 'mismatch';
}

export function readExpectedTimescaleImage(
    manifestPath = deployManifestPath()
): string {
    try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(raw) as {
            shared_services?: {fleet_db?: {image?: unknown}};
        };
        const image = manifest.shared_services?.fleet_db?.image;
        return typeof image === 'string' ? image : '';
    } catch {
        return '';
    }
}

export function buildDbRuntimeSnapshot(input: {
    postgresVersion: string;
    timescaleVersion: string;
    expectedTimescaleImage: string;
    nowMs?: number;
    error?: string;
}): DbRuntimeSnapshot {
    const nowMs = input.nowMs ?? Date.now();
    const expectedTimescaleVersion = timescaleVersionFromImage(
        input.expectedTimescaleImage
    );
    const status = input.error
        ? 'error'
        : compareTimescaleRuntime(
              input.timescaleVersion,
              expectedTimescaleVersion
          );
    return {
        status,
        statusCode: dbRuntimeStatusCode(status),
        checkedAt: new Date(nowMs).toISOString(),
        checkedAtMs: nowMs,
        checkAgeSeconds: 0,
        lastSuccessfulAt: input.error ? '' : new Date(nowMs).toISOString(),
        lastSuccessfulAtMs: input.error ? 0 : nowMs,
        lastSuccessfulAgeSeconds: input.error ? -1 : 0,
        postgresVersion: input.postgresVersion,
        postgresMajor: postgresMajorFromVersion(input.postgresVersion),
        timescaleVersion: input.timescaleVersion,
        expectedTimescaleImage: input.expectedTimescaleImage,
        expectedTimescaleVersion,
        error: input.error ?? ''
    };
}

export function buildDbRuntimeErrorSnapshot(
    error: string,
    nowMs = Date.now(),
    previous: DbRuntimeSnapshot = snapshot
): DbRuntimeSnapshot {
    return {
        ...previous,
        status: 'error',
        statusCode: dbRuntimeStatusCode('error'),
        checkedAt: new Date(nowMs).toISOString(),
        checkedAtMs: nowMs,
        checkAgeSeconds: 0,
        error
    };
}

export function setDbRuntimeSnapshot(next: DbRuntimeSnapshot): void {
    snapshot = next;
}

export function getDbRuntimeSnapshot(nowMs = Date.now()): DbRuntimeSnapshot {
    if (snapshot.checkedAtMs <= 0) return snapshot;
    return {
        ...snapshot,
        checkAgeSeconds: Math.max(
            0,
            Math.floor((nowMs - snapshot.checkedAtMs) / 1000)
        ),
        lastSuccessfulAgeSeconds: snapshot.lastSuccessfulAtMs
            ? Math.max(
                  0,
                  Math.floor((nowMs - snapshot.lastSuccessfulAtMs) / 1000)
              )
            : -1
    };
}

export function resetDbRuntimeSnapshotForTests(): void {
    snapshot = UNKNOWN;
}
