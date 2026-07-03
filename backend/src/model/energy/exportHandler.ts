/**
 * Shared export-download helpers for files served from
 * `/api/exports/download/:filename`.
 *
 * Filename → userId binding lives in `exportOwnership` (Redis prod,
 * in-memory OSS). No token in the URL — no access-log / Referer leak.
 *
 * Used by Report.Generate's engines and the auditDownload route.
 */

import {basename} from 'node:path';
import {escapeCsvFormula} from '../../modules/csvExport';
import {exportOwnership} from '../../modules/redis/services';
import RpcError from '../../rpc/RpcError';

const EXPORT_OWNERSHIP_TTL_SEC = 24 * 60 * 60;

// Single source of truth for the owner-bound download URL of a report file.
const DOWNLOAD_BASE = '/api/exports/download';

export function downloadUrlFor(fileOrPath: string): string {
    return `${DOWNLOAD_BASE}/${basename(fileOrPath)}`;
}

export async function isExportOwner(
    filename: string,
    userId: string
): Promise<boolean> {
    const owner = await exportOwnership.get(filename);
    return owner !== null && owner === userId;
}

// Owner-bind a CSV in uploads/reports. Optional ttlSec overrides the 24h
// default for callers with shorter retention requirements.
export async function bindExportOwner(
    filename: string,
    userId: string | undefined,
    ttlSec: number = EXPORT_OWNERSHIP_TTL_SEC
): Promise<void> {
    if (!userId) {
        throw RpcError.InvalidParams(
            'export owner binding requires an authenticated user'
        );
    }
    await exportOwnership.set(filename, userId, ttlSec);
}

// Re-export from the centralized helper so existing imports keep working.
export {escapeCsvFormula};
