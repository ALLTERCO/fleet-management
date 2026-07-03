import fs from 'node:fs/promises';
import path from 'node:path';
import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import {UPLOADS_DIR} from '../../modules/csvExport';
import * as PostgresProvider from '../../modules/PostgresProvider';
import {reportArtifactTtlMs} from './reportRetention';

const logger = getLogger('reportArtifactCleanup');
const REPORT_ARTIFACT_RE = /\.(csv\.gz|html)$/;

let cleanupTimer: NodeJS.Timeout | null = null;

export function startReportArtifactCleanup(): void {
    if (cleanupTimer) return;
    void cleanupExpiredReportArtifacts();
    cleanupTimer = setInterval(
        () => void cleanupExpiredReportArtifacts(),
        tuning.report.cleanupIntervalMs
    );
    cleanupTimer.unref?.();
}

export function stopReportArtifactCleanup(): void {
    if (!cleanupTimer) return;
    clearInterval(cleanupTimer);
    cleanupTimer = null;
}

export async function cleanupExpiredReportArtifacts(
    nowMs = Date.now()
): Promise<number> {
    let deleted = 0;
    try {
        const filenames = await fs.readdir(UPLOADS_DIR);
        for (const filename of filenames) {
            if (!REPORT_ARTIFACT_RE.test(filename)) continue;
            if (await deleteIfExpired(filename, nowMs)) deleted += 1;
        }
    } catch (error) {
        if ((error as {code?: string})?.code !== 'ENOENT') {
            logger.warn('report cleanup: readdir failed: %s', error);
        }
    }
    await cleanupExpiredReportInstances();
    return deleted;
}

export async function cleanupExpiredReportInstances(): Promise<number> {
    try {
        const rows = await PostgresProvider.queryRows<{id: number}>(
            `DELETE FROM logging.report_instances
              WHERE "timestamp" <= now() - ($1::int * interval '1 day')
              RETURNING id`,
            [tuning.report.artifactTtlDays]
        );
        return rows.length;
    } catch (error) {
        logger.warn('report cleanup: instance sweep failed: %s', error);
        return 0;
    }
}

async function deleteIfExpired(
    filename: string,
    nowMs: number
): Promise<boolean> {
    const filePath = path.join(UPLOADS_DIR, path.basename(filename));
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) return false;
    if (nowMs - stat.mtimeMs <= reportArtifactTtlMs()) return false;
    await fs.unlink(filePath).catch((error) => {
        logger.warn(
            'report cleanup: unlink failed for %s: %s',
            filename,
            error
        );
    });
    return true;
}
