import fs from 'node:fs/promises';
import path from 'node:path';
import {tuning} from '../../config/tuning';
import {uploadSessionExpiryForCleanup} from './uploadSessions';

export const UPLOAD_STAGING_CLEANUP_BATCH_SIZE = 200;
const UPLOAD_STAGING_LEGACY_GRACE_MS = 60_000;
export const uploadStagingRoot = path.resolve(
    __dirname,
    '../../../uploads/temp/file-transfer'
);

export interface UploadStagingCleanupResult {
    inspected: number;
    removed: number;
    cursor: string | null;
    more: boolean;
}

let scanDirectory: Awaited<ReturnType<typeof fs.opendir>> | null = null;
let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupRun: Promise<UploadStagingCleanupResult> | null = null;
let lifecycleStarted = false;

export function uploadStagingPath(uploadId: string): string {
    return path.join(uploadStagingRoot, uploadId);
}

async function closeScanDirectory(): Promise<void> {
    const directory = scanDirectory;
    scanDirectory = null;
    await directory?.close().catch(() => undefined);
}

async function cleanupBatch(): Promise<UploadStagingCleanupResult> {
    await fs.mkdir(uploadStagingRoot, {recursive: true});
    scanDirectory ??= await fs.opendir(uploadStagingRoot);
    let inspected = 0;
    let removed = 0;
    let cursor: string | null = null;

    try {
        while (inspected < UPLOAD_STAGING_CLEANUP_BATCH_SIZE) {
            const entry = await scanDirectory.read();
            if (!entry) {
                await closeScanDirectory();
                return {inspected, removed, cursor, more: false};
            }
            inspected++;
            cursor = entry.name;
            if (!entry.isFile() || !/^[0-9a-f-]{36}$/i.test(entry.name)) {
                continue;
            }

            // A store error leaves the file untouched and restarts the sweep.
            const expiresAt = await uploadSessionExpiryForCleanup(entry.name);
            if (expiresAt !== null && expiresAt > Date.now()) continue;
            if (expiresAt === null) {
                const stat = await fs
                    .stat(uploadStagingPath(entry.name))
                    .catch(() => null);
                if (
                    stat &&
                    Date.now() - stat.mtimeMs <=
                        tuning.upload.sessionTtlMs +
                            UPLOAD_STAGING_LEGACY_GRACE_MS
                ) {
                    continue;
                }
            }
            await fs
                .unlink(uploadStagingPath(entry.name))
                .catch((error: NodeJS.ErrnoException) => {
                    if (error.code !== 'ENOENT') throw error;
                });
            removed++;
        }
        return {inspected, removed, cursor, more: true};
    } catch (error) {
        await closeScanDirectory();
        throw error;
    }
}

export async function runUploadStagingCleanupBatch(): Promise<UploadStagingCleanupResult> {
    cleanupRun ??= cleanupBatch().finally(() => {
        cleanupRun = null;
    });
    return cleanupRun;
}

function cleanupIntervalMs(): number {
    return Math.max(
        1000,
        Math.min(
            tuning.firmware.tempCleanupIntervalMs,
            Math.floor(tuning.upload.sessionTtlMs / 3)
        )
    );
}

function scheduleCleanup(delayMs: number): void {
    if (!lifecycleStarted || cleanupTimer) return;
    cleanupTimer = setTimeout(() => {
        cleanupTimer = null;
        void runUploadStagingCleanupBatch()
            .then((result) => {
                scheduleCleanup(result.more ? 0 : cleanupIntervalMs());
            })
            .catch(() => {
                scheduleCleanup(cleanupIntervalMs());
            });
    }, delayMs);
    cleanupTimer.unref?.();
}

export function startUploadStagingCleanup(): void {
    if (lifecycleStarted) return;
    lifecycleStarted = true;
    scheduleCleanup(0);
}

export async function stopUploadStagingCleanup(): Promise<void> {
    lifecycleStarted = false;
    if (cleanupTimer) clearTimeout(cleanupTimer);
    cleanupTimer = null;
    await cleanupRun?.catch(() => undefined);
    await closeScanDirectory();
}
