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
    userId: string,
    organizationId?: string
): Promise<boolean> {
    const owner = await exportOwnership.get(filename);
    if (owner === null) return false;
    const principal = parseExportPrincipal(owner);
    if (!principal) return owner === userId;
    return (
        principal.userId === userId &&
        typeof organizationId === 'string' &&
        principal.organizationId === organizationId
    );
}

export async function bindExportPrincipal(
    filename: string,
    principal: {userId: string | undefined; organizationId: string | undefined},
    ttlSec: number = EXPORT_OWNERSHIP_TTL_SEC
): Promise<void> {
    if (!principal.userId || !principal.organizationId) {
        throw RpcError.InvalidParams(
            'report artifact binding requires an authenticated organization principal'
        );
    }
    await exportOwnership.set(filename, JSON.stringify(principal), ttlSec);
}

export async function unbindExportOwner(filename: string): Promise<void> {
    await exportOwnership.delete(filename);
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

function parseExportPrincipal(
    value: string
): {userId: string; organizationId: string} | null {
    if (!value.startsWith('{')) return null;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        return typeof parsed.userId === 'string' &&
            typeof parsed.organizationId === 'string'
            ? {userId: parsed.userId, organizationId: parsed.organizationId}
            : null;
    } catch {
        return null;
    }
}

// Re-export from the centralized helper so existing imports keep working.
export {escapeCsvFormula};
