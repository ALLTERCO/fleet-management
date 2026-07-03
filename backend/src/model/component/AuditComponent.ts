import crypto from 'node:crypto';
import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import path from 'node:path';
import {finished} from 'node:stream/promises';
import {getLogger} from 'log4js';
import {tuning} from '../../config/tuning';
import * as AuditLogger from '../../modules/AuditLogger';
import {canCrossOrganizationBoundary} from '../../modules/authz/evaluator';
import * as postgres from '../../modules/PostgresProvider';
import {bestEffort} from '../../modules/util/fireAndForget';
import type {DescribeOutput} from '../../rpc/describe';
import {buildListResponse} from '../../rpc/listResponse';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    AUDIT_DESCRIBE,
    AUDIT_EXPORT_PARAMS_SCHEMA,
    AUDIT_QUERY_PARAMS_SCHEMA
} from '../../types/api/audit';
import type CommandSender from '../CommandSender';
import {canViewAuditLog} from './authzPermissions';
import Component from './Component';
import {
    assertOrderedRange,
    parseDateParam,
    tenantReadScope
} from './readQuerySupport';

const logger = getLogger('audit-export');

const AUDIT_EXPORTS_PATH = path.join(__dirname, '../../../uploads/audit-logs');
// audit-log-<tenant-or-fleet>-<ms>-<nonce>.csv
// Tenant segment matches Zitadel org-id shape (digits) OR the literal
// 'fleet' for provider support instance-wide exports. The 8-char hex nonce
// avoids same-millisecond filename collisions between concurrent
// exporters (two admins in the same tenant clicking Export within the
// same ms would otherwise truncate each other's CSV and the
// ON CONFLICT clause would overwrite the owner row).
// Older single-nonce-free files match the optional group for back-compat.
const AUDIT_EXPORT_FILENAME_RE =
    /^audit-log-([0-9]+|fleet)-(\d+)(?:-[a-f0-9]{8})?\.csv$/;

// Page windows for a capped CSV export: successive (offset, limit) pairs whose
// total never exceeds maxRows, so the export can't fetch the whole audit table.
// The caller stops early once the source runs dry — this only bounds the
// ceiling. The final window is clamped so the row total lands exactly on
// maxRows rather than overshooting by up to a full batch.
export function planExportPages(
    maxRows: number,
    batchSize: number
): Array<{offset: number; limit: number}> {
    const pages: Array<{offset: number; limit: number}> = [];
    for (let offset = 0; offset < maxRows; offset += batchSize) {
        pages.push({offset, limit: Math.min(batchSize, maxRows - offset)});
    }
    return pages;
}

let exportsCleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startAuditExportsCleanup(): void {
    if (exportsCleanupTimer) return;
    if (!fs.existsSync(AUDIT_EXPORTS_PATH)) {
        fs.mkdirSync(AUDIT_EXPORTS_PATH, {recursive: true});
    }
    void cleanupExpiredAuditExports();
    exportsCleanupTimer = setInterval(
        () => void cleanupExpiredAuditExports(),
        tuning.audit.exportsCleanupIntervalMs
    );
    exportsCleanupTimer.unref?.();
}

export function stopAuditExportsCleanup(): void {
    if (!exportsCleanupTimer) return;
    clearInterval(exportsCleanupTimer);
    exportsCleanupTimer = null;
}

// Audit export ownership + tickets live in Postgres (migration 6107).
// Previously held in process memory, which broke download-after-restart
// and download-on-a-peer-pod flows. Schema:
//   logging.audit_exports         (filename PK, owner_id, created_at)
//   logging.audit_export_tickets  (ticket PK, filename FK, user_id, expires_at)

async function clearAuditDownloadTickets(filename: string): Promise<void> {
    // Cascade deletes the tickets via FK ON DELETE CASCADE.
    await postgres.queryRows(
        'DELETE FROM logging.audit_exports WHERE filename = $1',
        [filename]
    );
}

export async function bindAuditExportOwner(
    filename: string,
    userId: string
): Promise<void> {
    // ON CONFLICT DO NOTHING is the right policy: filenames carry an
    // 8-char nonce so a duplicate row means a re-export of the SAME file
    // (programmer error / retry) — keep the original owner, don't let a
    // second caller silently steal it.
    await postgres.queryRows(
        `INSERT INTO logging.audit_exports (filename, owner_id) VALUES ($1, $2)
         ON CONFLICT (filename) DO NOTHING`,
        [filename, userId]
    );
}

export async function getAuditExportOwner(
    filename: string
): Promise<string | undefined> {
    const rows = await postgres.queryRows<{owner_id: string}>(
        'SELECT owner_id FROM logging.audit_exports WHERE filename = $1',
        [filename]
    );
    return rows[0]?.owner_id;
}

export async function createAuditDownloadUrl(
    filename: string,
    userId: string
): Promise<string> {
    const ticket = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + tuning.audit.exportTtlMs);
    await postgres.queryRows(
        `INSERT INTO logging.audit_export_tickets
             (ticket, filename, user_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [ticket, filename, userId, expiresAt.toISOString()]
    );
    return `/api/audit-log/download/${filename}?ticket=${encodeURIComponent(ticket)}`;
}

export async function hasValidAuditDownloadTicket(
    filename: string,
    ticket: string | undefined,
    userId: string | undefined
): Promise<boolean> {
    if (!ticket || !userId) return false;
    const rows = await postgres.queryRows<{found: boolean}>(
        `SELECT TRUE AS found
           FROM logging.audit_export_tickets
          WHERE ticket = $1::uuid
            AND filename = $2
            AND user_id = $3
            AND expires_at > now()
          LIMIT 1`,
        [ticket, filename, userId]
    );
    return rows[0]?.found === true;
}

export function getAuditDownloadPath(filename: string): string {
    return `/api/audit-log/download/${filename}`;
}

export function getAuditDownloadTicketPath(filename: string): string {
    return `/api/audit-log/download-ticket/${filename}`;
}

function getAuditExportCreatedAt(filename: string): number | null {
    // Regex: /^audit-log-([0-9]+|fleet)-(\d+)\.csv$/
    // group 1 = tenant segment, group 2 = epoch ms (the timestamp).
    const match = filename.match(AUDIT_EXPORT_FILENAME_RE);
    if (!match) return null;
    const createdAt = Number(match[2]);
    return Number.isFinite(createdAt) ? createdAt : null;
}

// Orchestrator: three independent passes (expired files, stale tickets,
// orphan rows). Each pass is best-effort and logs its own failures.
async function cleanupExpiredAuditExports() {
    const onDiskNames = await deleteExpiredAuditExportFiles();
    await deleteStaleAuditDownloadTickets();
    await reconcileOrphanAuditExportRows(onDiskNames);
}

// Walks AUDIT_EXPORTS_PATH, deletes files older than audit.exportTtlMs,
// and clears their download tickets. Returns the full set of names that
// were on disk this pass (used by the orphan reconciler).
async function deleteExpiredAuditExportFiles(): Promise<Set<string>> {
    const now = Date.now();
    const onDiskNames = new Set<string>();
    try {
        const filenames = await fsAsync.readdir(AUDIT_EXPORTS_PATH);
        for (const f of filenames) onDiskNames.add(f);
        await Promise.all(
            filenames
                .filter((filename) => AUDIT_EXPORT_FILENAME_RE.test(filename))
                .map(async (filename) => {
                    const createdAt =
                        getAuditExportCreatedAt(filename) ??
                        (
                            await fsAsync.stat(
                                path.join(AUDIT_EXPORTS_PATH, filename)
                            )
                        ).mtimeMs;
                    if (now - createdAt <= tuning.audit.exportTtlMs) return;
                    await fsAsync
                        .unlink(path.join(AUDIT_EXPORTS_PATH, filename))
                        .catch((err) =>
                            logger.warn(
                                'audit cleanup: unlink failed for %s: %s',
                                filename,
                                err
                            )
                        );
                    await clearAuditDownloadTickets(filename);
                })
        );
    } catch (err: any) {
        if (err?.code !== 'ENOENT') {
            logger.warn('audit cleanup: readdir failed: %s', err);
        }
    }
    return onDiskNames;
}

// Sweep stale ticket rows so the table doesn't grow unbounded.
async function deleteStaleAuditDownloadTickets(): Promise<void> {
    try {
        await postgres.queryRows(
            'DELETE FROM logging.audit_export_tickets WHERE expires_at <= now()'
        );
    } catch (err) {
        logger.warn('audit cleanup: stale ticket sweep failed: %s', err);
    }
}

// Reconcile orphan owner rows — files manually deleted (volume restore,
// ops cleanup, ENOENT during unlink) would otherwise leave a permanent
// row + tickets pointing nowhere.
async function reconcileOrphanAuditExportRows(
    onDiskNames: ReadonlySet<string>
): Promise<void> {
    try {
        const ownerRows = await postgres.queryRows<{filename: string}>(
            'SELECT filename FROM logging.audit_exports'
        );
        const orphans = ownerRows
            .map((r) => r.filename)
            .filter((f) => !onDiskNames.has(f));
        if (orphans.length === 0) return;
        await postgres.queryRows(
            'DELETE FROM logging.audit_exports WHERE filename = ANY($1::text[])',
            [orphans]
        );
        logger.info(
            'audit cleanup: reaped %d orphan owner row(s)',
            orphans.length
        );
    } catch (err) {
        logger.warn('audit cleanup: orphan reconcile failed: %s', err);
    }
}

interface AuditLogConfig {
    enabled: boolean;
}

export default class AuditComponent extends Component<AuditLogConfig> {
    constructor() {
        super('audit');
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return AUDIT_DESCRIBE;
    }

    @Component.NoAudit
    @Component.Expose('Query')
    @Component.Alias('auditlog.query')
    @Component.CheckPermissions(canViewAuditLog)
    async query(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<{
            from?: string;
            to?: string;
            eventTypes?: string[];
            username?: string;
            shellyId?: string;
            limit?: number;
            offset?: number;
        }>(rawParams, AUDIT_QUERY_PARAMS_SCHEMA);
        const limit = params.limit ?? 200;
        const offset = params.offset ?? 0;
        const from = parseDateParam(params.from, 'from');
        const to = parseDateParam(params.to, 'to');
        assertOrderedRange(from, to);

        const rows = await AuditLogger.query({
            organizationId: tenantReadScope(sender),
            from,
            to,
            eventTypes: params.eventTypes as AuditLogger.AuditEventType[],
            username: params.username,
            shellyId: params.shellyId,
            limit,
            offset
        });
        // Total is estimated — rows.length === limit means there may be more
        const hasMore = rows.length >= limit;
        return buildListResponse(
            rows,
            hasMore ? offset + rows.length + 1 : offset + rows.length,
            limit,
            offset
        );
    }

    @Component.NoAudit
    @Component.Expose('Export')
    @Component.Alias('auditlog.export')
    @Component.CheckPermissions(canViewAuditLog)
    async export(rawParams: unknown, sender: CommandSender) {
        const params = validateOrThrow<{
            from: string;
            to: string;
            eventTypes?: string[];
        }>(rawParams, AUDIT_EXPORT_PARAMS_SCHEMA);
        const timestamp = Date.now();
        const exportStartedAt = new Date(timestamp);
        const requestedFrom = parseDateParam(params.from, 'from', {
            required: true
        })!;
        const requestedTo = parseDateParam(params.to, 'to', {
            required: true
        })!;
        const effectiveTo =
            requestedTo.getTime() > exportStartedAt.getTime()
                ? exportStartedAt
                : requestedTo;
        assertOrderedRange(requestedFrom, effectiveTo);
        // Fail-loud if the caller has no resolved user — without an
        // owner the export would still write to disk and then be
        // permanently undownloadable (every route check would 403).
        const ownerId = sender.getUser()?.userId;
        if (!ownerId) {
            throw RpcError.InvalidParams(
                'audit.Export: no user identity on sender'
            );
        }
        const tenantSegment = canCrossOrganizationBoundary(sender)
            ? 'fleet'
            : (sender.getOrganizationId() ?? 'fleet');
        // 8-char hex nonce makes the filename collision-resistant when
        // two exports land in the same millisecond.
        const nonce = crypto.randomBytes(4).toString('hex');
        const filename = `audit-log-${tenantSegment}-${timestamp}-${nonce}.csv`;
        const filePath = path.join(AUDIT_EXPORTS_PATH, filename);
        const csvStream = fs.createWriteStream(filePath, {encoding: 'utf-8'});
        let rowCount = 0;

        // Build CSV content
        const headers = [
            'timestamp',
            'event_type',
            'username',
            'device_id',
            'method',
            'success',
            'error',
            'ip_address',
            'params'
        ];

        try {
            await this.writeCsvChunk(csvStream, `${headers.join(',')}\n`);
            rowCount = await this.streamAuditRowsToCsv(csvStream, {
                organizationId: tenantReadScope(sender),
                from: requestedFrom,
                to: effectiveTo,
                eventTypes: params.eventTypes as AuditLogger.AuditEventType[]
            });
            csvStream.end();
            await finished(csvStream);
        } catch (error) {
            csvStream.destroy();
            await bestEffort(
                'unlink.audit-download-temp',
                fsAsync.unlink(filePath)
            );
            throw error;
        }
        // Bind export → owner so the download routes can refuse cross-
        // tenant pulls. AUDIT_EXPORTS_PATH is a shared directory, so a
        // filename alone is not enough to authorise.
        await bindAuditExportOwner(filename, ownerId);
        return {
            filename,
            downloadUrl: getAuditDownloadPath(filename),
            downloadTicketUrl: getAuditDownloadTicketPath(filename),
            rows: rowCount,
            generated: new Date().toISOString()
        };
    }

    // Pages through AuditLogger.query() in fixed-size batches, writing each
    // row to the supplied stream and returning the total row count. Caller
    // owns stream lifecycle (open + close + error cleanup).
    private async streamAuditRowsToCsv(
        stream: fs.WriteStream,
        query: {
            organizationId: string | null;
            from: Date;
            to: Date;
            eventTypes?: AuditLogger.AuditEventType[];
        }
    ): Promise<number> {
        let rowCount = 0;
        const pages = planExportPages(
            tuning.audit.exportMaxRows,
            tuning.audit.exportBatchSize
        );
        for (const {offset, limit} of pages) {
            const rows = await AuditLogger.query({...query, limit, offset});
            if (rows.length === 0) break;
            await this.writeCsvChunk(stream, this.formatAuditRowsAsCsv(rows));
            rowCount += rows.length;
            if (rows.length < limit) break;
        }
        return rowCount;
    }

    // Pure transform: AuditLogger row list -> trailing-newline CSV chunk.
    // Single-device rows use shelly_id; bulk rows fall back to shelly_ids.
    private formatAuditRowsAsCsv(
        rows: readonly AuditLogger.AuditLogRow[]
    ): string {
        return `${rows
            .map((row) => {
                const deviceCell =
                    row.shelly_id || (row.shelly_ids?.join('|') ?? '');
                return [
                    this.escapeCsvField(row.ts?.toISOString() || ''),
                    this.escapeCsvField(row.event_type || ''),
                    this.escapeCsvField(row.username || ''),
                    this.escapeCsvField(deviceCell),
                    this.escapeCsvField(row.method || ''),
                    row.success ? 'true' : 'false',
                    this.escapeCsvField(row.error_message || ''),
                    this.escapeCsvField(row.ip_address || ''),
                    this.escapeCsvField(JSON.stringify(row.params || {}))
                ].join(',');
            })
            .join('\n')}\n`;
    }

    private async writeCsvChunk(stream: fs.WriteStream, chunk: string) {
        if (stream.write(chunk)) return;
        await new Promise<void>((resolve, reject) => {
            const onDrain = () => {
                stream.off('error', onError);
                resolve();
            };
            const onError = (error: Error) => {
                stream.off('drain', onDrain);
                reject(error);
            };
            stream.once('drain', onDrain);
            stream.once('error', onError);
        });
    }

    private escapeCsvField(field: string): string {
        let safeField = field;
        if (/^[=+\-@\t\r]/.test(safeField)) {
            safeField = `'${safeField}`;
        }

        if (
            safeField.includes(',') ||
            safeField.includes('"') ||
            safeField.includes('\n')
        ) {
            return `"${safeField.replace(/"/g, '""')}"`;
        }
        return safeField;
    }

    protected override getDefaultConfig(): AuditLogConfig {
        return {
            enabled: true
        };
    }
}

export {AUDIT_EXPORTS_PATH};
