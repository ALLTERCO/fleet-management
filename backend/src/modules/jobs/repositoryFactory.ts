import type {
    CertificatePushRow,
    CertificatePushStatus
} from '../../types/api/certificate';
import type {
    OperationJobKind,
    OperationJobSnapshot,
    OperationJobStatus
} from '../../types/api/job';

export interface CredentialPushRow {
    id: number;
    job_id: string;
    device_id: string;
    status: string;
    last_error: string | null;
}

export interface BackupQueuedUnit {
    id: number;
    job_id: string;
    tenant_id: string;
    logical_device_id: number;
    device_id: string;
    mode: 'create' | 'restore';
    target_summary: Record<string, unknown>;
}

export interface BackupUnitCounts {
    pending: number;
    failed: number;
}

export interface BackupDeviceOwnership {
    organizationId: string;
    device: {
        id: number | null;
        external_id: string;
    };
    currentExternalId: string | null;
    currentOrganizationId: string | null;
}

export interface BackupDeviceOwnershipProbe {
    backupId: string;
    organizationId: string;
    device: {
        id: number | null;
        external_id: string;
    };
}

export interface FirmwareQueuedUnit {
    id: number;
    job_id: string;
    tenant_id: string;
    logical_device_id: number;
    device_id: string;
    mode: 'channel' | 'url';
    target_summary: Record<string, unknown>;
    request: Record<string, unknown>;
}

export interface FirmwareUnitCounts {
    pending: number;
    failed: number;
}

interface JobDbRow {
    id: string;
    kind: OperationJobKind;
    status: OperationJobStatus;
    total: number | string | null;
    done_count: number | string | null;
    fail_count: number | string | null;
    created_at: Date | string;
    started_at: Date | string | null;
    ended_at: Date | string | null;
    created_by: string | null;
    metadata: Record<string, unknown> | null;
}

interface JobQuery {
    tenantId: string;
    kinds?: OperationJobKind[];
    limit?: number;
}

interface GetJobQuery {
    tenantId: string;
    jobId: string;
    kind?: OperationJobKind;
}

interface CreateCertificateJobQuery {
    tenantId: string;
    certificateId: string;
    slot: string;
    target: unknown;
    createdBy: string;
}

interface EnqueueCertificateTargetsQuery {
    tenantId: string;
    jobId: string;
    certificateId: string;
    slot: string;
    deviceIds: string[];
}

interface CreateCredentialJobQuery {
    tenantId: string;
    target: unknown;
    mode: 'set' | 'rotate' | 'clear';
    createdBy: string;
}

interface CreateBackupJobQuery {
    tenantId: string;
    target: unknown;
    mode: 'create' | 'restore';
    createdBy: string;
    idempotencyKey?: string;
    requestHash: string;
}

export interface CreatedBackupJob {
    jobId: string;
    created: boolean;
}

interface CreateFirmwareJobQuery {
    tenantId: string;
    target: unknown;
    mode: 'channel' | 'url';
    createdBy: string;
    idempotencyKey?: string;
    requestHash: string;
}

export interface CreatedFirmwareJob {
    jobId: string;
    created: boolean;
}

interface EnqueueBackupTargetsQuery {
    tenantId: string;
    jobId: string;
    deviceIds: string[];
}

interface EnqueueFirmwareTargetsQuery {
    tenantId: string;
    jobId: string;
    deviceIds: string[];
    request: unknown;
}

interface FinishJobQuery {
    tenantId: string;
    jobId: string;
    kind: OperationJobKind;
    status: Extract<OperationJobStatus, 'done' | 'failed'>;
}

interface MarkJobRunningQuery {
    tenantId: string;
    jobId: string;
    kind: OperationJobKind;
}

interface MarkCertificateUnitQuery {
    id: number;
    status: CertificatePushStatus;
    lastError: string | null;
    requiresReboot: boolean;
}

interface MarkCredentialUnitQuery {
    id: number;
    status: 'ok' | 'failed' | 'unknown';
    lastError: string | null;
}

interface ListQueuedBackupUnitsQuery {
    limit: number;
}

interface MarkBackupUnitDoneQuery {
    id: number;
    backupId?: string;
    result?: unknown;
}

interface MarkBackupUnitFailedQuery {
    id: number;
    lastError: string;
}

interface GetBackupUnitCountsQuery {
    tenantId: string;
    jobId: string;
}

interface ReclaimStaleBackupUnitsQuery {
    timeoutMs: number;
}

interface ListQueuedFirmwareUnitsQuery {
    limit: number;
}

interface MarkFirmwareUnitProgressQuery {
    id: number;
    phase: string;
    progressPercent?: number;
}

interface MarkFirmwareUnitDoneQuery {
    id: number;
    finalVersion?: string;
    finalFwId?: string;
    result?: unknown;
}

interface MarkFirmwareUnitFailedQuery {
    id: number;
    lastError: string;
}

interface GetFirmwareUnitCountsQuery {
    tenantId: string;
    jobId: string;
}

interface ReclaimStaleFirmwareUnitsQuery {
    timeoutMs: number;
}

type QueryRows = <T = unknown>(
    sql: string,
    params?: readonly unknown[]
) => Promise<T[]>;

type CallMethod = (
    method: string,
    params: Record<string, unknown>
) => Promise<{rows?: unknown[]} | undefined>;

const ACTIVE_STATUSES: readonly OperationJobStatus[] = ['queued', 'running'];
const ALL_JOB_KINDS: readonly OperationJobKind[] = [
    'certificate',
    'credential',
    'backup',
    'firmware'
];
const DEFAULT_LIMIT = 50;
export const LOGICAL_DEVICE_LOCK_NAMESPACE = 73002;

function normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function normalizeCount(value: number | string | null): number {
    const parsed =
        typeof value === 'string' ? Number.parseInt(value, 10) : value;
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed ?? 0));
}

function toIsoString(value: Date | string | null): string | null {
    if (value === null) return null;
    return value instanceof Date ? value.toISOString() : value;
}

function mapJobRow(row: JobDbRow): OperationJobSnapshot {
    return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        total: normalizeCount(row.total),
        doneCount: normalizeCount(row.done_count),
        failCount: normalizeCount(row.fail_count),
        createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
        startedAt: toIsoString(row.started_at),
        endedAt: toIsoString(row.ended_at),
        createdBy: row.created_by,
        metadata: row.metadata ?? {}
    };
}

function includesKind(
    kinds: readonly OperationJobKind[] | undefined,
    kind: OperationJobKind
): boolean {
    return !kinds || kinds.includes(kind);
}

function activeStatusFilter(): string {
    return 'AND j.status IN ($2, $3)';
}

function certificateJobsSql(statusFilter: string): string {
    return `
        SELECT
            j.id::text AS id,
            'certificate'::text AS kind,
            j.status::text AS status,
            count(p.id)::int AS total,
            count(p.id) FILTER (WHERE p.status = 'applied')::int AS done_count,
            count(p.id) FILTER (WHERE p.status IN ('failed', 'rolled_back'))::int AS fail_count,
            j.created_at,
            j.started_at,
            j.finished_at AS ended_at,
            j.created_by::text AS created_by,
            jsonb_build_object(
                'certificateId', j.certificate_id::text,
                'slot', j.slot,
                'targetSummary', j.target_summary
            ) AS metadata
          FROM organization.certificate_jobs j
          LEFT JOIN organization.certificate_pushes p ON p.job_id = j.id
         WHERE j.tenant_id = $1
           ${statusFilter}
         GROUP BY
            j.id,
            j.status,
            j.created_at,
            j.started_at,
            j.finished_at,
            j.created_by,
            j.certificate_id,
            j.slot,
            j.target_summary
    `;
}

function credentialJobsSql(statusFilter: string): string {
    return `
        SELECT
            j.id::text AS id,
            'credential'::text AS kind,
            j.status::text AS status,
            count(p.id)::int AS total,
            count(p.id) FILTER (WHERE p.status = 'ok')::int AS done_count,
            count(p.id) FILTER (WHERE p.status IN ('failed', 'unknown'))::int AS fail_count,
            j.created_at,
            j.started_at,
            j.finished_at AS ended_at,
            j.created_by::text AS created_by,
            jsonb_build_object(
                'mode', j.mode,
                'targetSummary', j.target_summary
            ) AS metadata
          FROM organization.credential_jobs j
          LEFT JOIN organization.credential_pushes p ON p.job_id = j.id
         WHERE j.tenant_id = $1
           ${statusFilter}
         GROUP BY
            j.id,
            j.status,
            j.created_at,
            j.started_at,
            j.finished_at,
            j.created_by,
            j.mode,
            j.target_summary
    `;
}

function backupJobsSql(statusFilter: string): string {
    return `
        SELECT
            j.id::text AS id,
            'backup'::text AS kind,
            j.status::text AS status,
            count(u.id)::int AS total,
            count(u.id) FILTER (WHERE u.status = 'done')::int AS done_count,
            count(u.id) FILTER (WHERE u.status = 'failed')::int AS fail_count,
            j.created_at,
            j.started_at,
            j.finished_at AS ended_at,
            j.created_by::text AS created_by,
            jsonb_build_object(
                'mode', j.mode,
                'targetSummary', j.target_summary,
                'lastError', j.last_error
            ) AS metadata
          FROM organization.backup_jobs j
          LEFT JOIN organization.backup_units u ON u.job_id = j.id
         WHERE j.tenant_id = $1
           ${statusFilter}
         GROUP BY
            j.id,
            j.status,
            j.created_at,
            j.started_at,
            j.finished_at,
            j.created_by,
            j.mode,
            j.target_summary,
            j.last_error
    `;
}

function firmwareJobsSql(statusFilter: string): string {
    return `
        SELECT
            j.id::text AS id,
            'firmware'::text AS kind,
            j.status::text AS status,
            count(u.id)::int AS total,
            count(u.id) FILTER (WHERE u.status = 'done')::int AS done_count,
            count(u.id) FILTER (WHERE u.status = 'failed')::int AS fail_count,
            j.created_at,
            j.started_at,
            j.finished_at AS ended_at,
            j.created_by::text AS created_by,
            jsonb_build_object(
                'mode', j.mode,
                'targetSummary', j.target_summary,
                'lastError', j.last_error
            ) AS metadata
          FROM organization.firmware_jobs j
          LEFT JOIN organization.firmware_units u ON u.job_id = j.id
         WHERE j.tenant_id = $1
           ${statusFilter}
         GROUP BY
            j.id,
            j.status,
            j.created_at,
            j.started_at,
            j.finished_at,
            j.created_by,
            j.mode,
            j.target_summary,
            j.last_error
    `;
}

function jobsSqlFor(kind: OperationJobKind, statusFilter: string): string {
    if (kind === 'certificate') return certificateJobsSql(statusFilter);
    if (kind === 'credential') return credentialJobsSql(statusFilter);
    if (kind === 'backup') return backupJobsSql(statusFilter);
    return firmwareJobsSql(statusFilter);
}

function jobTable(kind: OperationJobKind): string {
    if (kind === 'certificate') return 'organization.certificate_jobs';
    if (kind === 'credential') return 'organization.credential_jobs';
    if (kind === 'backup') return 'organization.backup_jobs';
    return 'organization.firmware_jobs';
}

function activeJobsUnionSql(
    kinds: readonly OperationJobKind[] | undefined
): string {
    return ALL_JOB_KINDS.filter((kind) => includesKind(kinds, kind))
        .map((kind) => jobsSqlFor(kind, activeStatusFilter()))
        .join('\nUNION ALL\n');
}

function getJobSql(kind: OperationJobKind): string {
    return `
        SELECT *
          FROM (${jobsSqlFor(kind, '')}) jobs
         WHERE jobs.id = $2
         LIMIT 1
    `;
}

function getJobKinds(
    kind: OperationJobKind | undefined
): readonly OperationJobKind[] {
    return kind ? [kind] : ALL_JOB_KINDS;
}

function finishJobSql(kind: OperationJobKind): string {
    return `
        UPDATE ${jobTable(kind)}
           SET status = $1,
               finished_at = now()
         WHERE id = $2
           AND tenant_id = $3
           AND status IN ('queued', 'running')
    `;
}

function markJobRunningSql(kind: OperationJobKind): string {
    return `
        UPDATE ${jobTable(kind)}
           SET status = 'running',
               started_at = COALESCE(started_at, now())
         WHERE id = $1
           AND tenant_id = $2
           AND status = 'queued'
    `;
}

function markCertificateUnitSql(): string {
    return `
        UPDATE organization.certificate_pushes
           SET status = $1,
               last_error = $2,
               applied_at = CASE WHEN $1 = 'applied' THEN now() ELSE applied_at END,
               requires_reboot = $3
         WHERE id = $4
     RETURNING id, job_id::text, certificate_id::text, device_id, slot,
               status, last_error, applied_at, requires_reboot, retry_count
    `;
}

function markCredentialUnitSql(): string {
    return `
        UPDATE organization.credential_pushes
           SET status = $1,
               last_error = $2,
               applied_at = CASE WHEN $1 = 'ok' THEN now() ELSE applied_at END
         WHERE id = $3
     RETURNING id, job_id::text, device_id, status, last_error
    `;
}

function selectQueuedBackupUnitsSql(): string {
    return `
        WITH candidates AS MATERIALIZED (
              SELECT u.id, u.logical_device_id
                FROM organization.backup_units u
                JOIN organization.backup_jobs j ON j.id = u.job_id
               WHERE u.status = 'queued'
                 AND j.status IN ('queued', 'running')
                 AND u.logical_device_id IS NOT NULL
               ORDER BY u.id ASC
               LIMIT $1
        ), bound AS MATERIALIZED (
              SELECT candidates.id,
                     candidates.logical_device_id,
                     device.external_id
                FROM candidates
                JOIN device.list device
                  ON device.id = candidates.logical_device_id
                JOIN organization.backup_units unit
                  ON unit.id = candidates.id
                 AND device.organization_id = unit.tenant_id
               ORDER BY candidates.logical_device_id, candidates.id
               FOR UPDATE OF device
        ), locked AS MATERIALIZED (
              SELECT bound.*,
                     pg_advisory_xact_lock(
                         ${LOGICAL_DEVICE_LOCK_NAMESPACE},
                         bound.logical_device_id
                     ) AS identity_lock
                FROM bound
               ORDER BY bound.logical_device_id, bound.id
        ), claimable AS MATERIALIZED (
              SELECT unit.id,
                     locked.logical_device_id,
                     locked.external_id
                FROM locked
                JOIN organization.backup_units unit ON unit.id = locked.id
               WHERE unit.status = 'queued'
               FOR UPDATE OF unit SKIP LOCKED
        ), claimed AS (
              UPDATE organization.backup_units unit
                 SET status = 'in_progress',
                     phase = 'running',
                     picked_up_at = now()
                FROM claimable
               WHERE unit.id = claimable.id
           RETURNING unit.id,
                     unit.job_id,
                     unit.tenant_id,
                     claimable.logical_device_id,
                     claimable.external_id
        )
        SELECT claimed.id,
               claimed.job_id::text,
               claimed.tenant_id,
               claimed.logical_device_id,
               claimed.external_id AS device_id,
               job.mode,
               job.target_summary
          FROM claimed
          JOIN organization.backup_jobs job ON job.id = claimed.job_id
         ORDER BY claimed.id
    `;
}

function markBackupUnitDoneSql(): string {
    return `
        UPDATE organization.backup_units
           SET status = 'done',
               phase = 'done',
               backup_id = $2,
               result = $3::jsonb,
               last_error = NULL,
               finished_at = now()
         WHERE id = $1
    `;
}

function markBackupUnitFailedSql(): string {
    return `
        UPDATE organization.backup_units
           SET status = 'failed',
               phase = 'failed',
               last_error = $2,
               finished_at = now()
         WHERE id = $1
    `;
}

function backupUnitCountsSql(): string {
    return `
        SELECT
            COUNT(*) FILTER (WHERE status IN ('queued', 'in_progress'))::int AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM organization.backup_units
         WHERE job_id = $1
           AND tenant_id = $2
    `;
}

// The org that captured a stored backup = the tenant of its create-mode unit.
// Authoritative even after the device transfers orgs, so a read can be scoped
// to the capturing org instead of whoever can reach the device now.
function backupCaptureOwnersSql(): string {
    return `
        SELECT DISTINCT ON (bu.backup_id)
               bu.backup_id,
               bu.tenant_id,
               COALESCE(
                   bu.logical_device_id,
                   current_device.id,
                   retired.device_id
               ) AS logical_device_id,
               bu.device_id AS snapshot_external_id,
               bound_device.external_id AS current_external_id,
               bound_device.organization_id AS current_organization_id
          FROM organization.backup_units bu
          JOIN organization.backup_jobs bj ON bj.id = bu.job_id
          LEFT JOIN device.list current_device
            ON current_device.organization_id = bu.tenant_id
           AND current_device.external_id = bu.device_id
          LEFT JOIN device.retired_external_identity retired
            ON retired.organization_id = bu.tenant_id
           AND retired.external_id = bu.device_id
          LEFT JOIN device.list bound_device
            ON bound_device.id = COALESCE(
                bu.logical_device_id,
                current_device.id,
                retired.device_id
            )
         WHERE bu.backup_id = ANY($1)
           AND bj.mode = 'create'
         ORDER BY bu.backup_id, bu.id ASC
    `;
}

function resolveBackupDeviceOwnersSql(): string {
    return `
        WITH requested AS (
            SELECT *
              FROM jsonb_to_recordset($1::jsonb) AS probe(
                  backup_id VARCHAR,
                  organization_id VARCHAR,
                  logical_device_id INT,
                  snapshot_external_id VARCHAR
              )
        )
        SELECT requested.backup_id,
               requested.organization_id AS tenant_id,
               COALESCE(
                   requested.logical_device_id,
                   current_device.id,
                   retired.device_id
               ) AS logical_device_id,
               requested.snapshot_external_id,
               bound_device.external_id AS current_external_id,
               bound_device.organization_id AS current_organization_id
          FROM requested
          LEFT JOIN device.list current_device
            ON current_device.organization_id = requested.organization_id
           AND current_device.external_id = requested.snapshot_external_id
          LEFT JOIN device.retired_external_identity retired
            ON retired.organization_id = requested.organization_id
           AND retired.external_id = requested.snapshot_external_id
          LEFT JOIN device.list bound_device
            ON bound_device.id = COALESCE(
                requested.logical_device_id,
                current_device.id,
                retired.device_id
            )
    `;
}

function reclaimStaleBackupUnitsSql(): string {
    return `
        UPDATE organization.backup_units
           SET status = 'failed',
               phase = 'failed',
               last_error = 'fm_restart_during_backup_job',
               finished_at = now()
         WHERE status = 'in_progress'
           AND (picked_up_at IS NULL OR picked_up_at < now() - ($1 || ' ms')::interval)
     RETURNING id
    `;
}

function selectQueuedFirmwareUnitsSql(): string {
    return `
        WITH candidates AS MATERIALIZED (
              SELECT u.id, u.logical_device_id
                FROM organization.firmware_units u
                JOIN organization.firmware_jobs j ON j.id = u.job_id
               WHERE u.status = 'queued'
                 AND j.status IN ('queued', 'running')
                 AND u.logical_device_id IS NOT NULL
               ORDER BY u.id ASC
               LIMIT $1
        ), bound AS MATERIALIZED (
              SELECT candidates.id,
                     candidates.logical_device_id,
                     device.external_id
                FROM candidates
                JOIN device.list device
                  ON device.id = candidates.logical_device_id
                JOIN organization.firmware_units unit
                  ON unit.id = candidates.id
                 AND device.organization_id = unit.tenant_id
               ORDER BY candidates.logical_device_id, candidates.id
               FOR UPDATE OF device
        ), locked AS MATERIALIZED (
              SELECT bound.*,
                     pg_advisory_xact_lock(
                         ${LOGICAL_DEVICE_LOCK_NAMESPACE},
                         bound.logical_device_id
                     ) AS identity_lock
                FROM bound
               ORDER BY bound.logical_device_id, bound.id
        ), claimable AS MATERIALIZED (
              SELECT unit.id,
                     locked.logical_device_id,
                     locked.external_id
                FROM locked
                JOIN organization.firmware_units unit ON unit.id = locked.id
               WHERE unit.status = 'queued'
               FOR UPDATE OF unit SKIP LOCKED
        ), claimed AS (
              UPDATE organization.firmware_units unit
                 SET status = 'in_progress',
                     phase = 'starting',
                     picked_up_at = now()
                FROM claimable
               WHERE unit.id = claimable.id
           RETURNING unit.id,
                     unit.job_id,
                     unit.tenant_id,
                     unit.request,
                     claimable.logical_device_id,
                     claimable.external_id
        )
        SELECT claimed.id,
               claimed.job_id::text,
               claimed.tenant_id,
               claimed.logical_device_id,
               claimed.external_id AS device_id,
               job.mode,
               job.target_summary,
               claimed.request
          FROM claimed
          JOIN organization.firmware_jobs job ON job.id = claimed.job_id
         ORDER BY claimed.id
    `;
}

function markFirmwareUnitProgressSql(): string {
    return `
        UPDATE organization.firmware_units
           SET status = 'in_progress',
               phase = $2,
               progress_percent = $3
         WHERE id = $1
    `;
}

function markFirmwareUnitDoneSql(): string {
    return `
        UPDATE organization.firmware_units
           SET status = 'done',
               phase = 'done',
               progress_percent = 100,
               final_version = $2,
               final_fw_id = $3,
               result = $4::jsonb,
               last_error = NULL,
               finished_at = now()
         WHERE id = $1
    `;
}

function markFirmwareUnitFailedSql(): string {
    return `
        UPDATE organization.firmware_units
           SET status = 'failed',
               phase = 'failed',
               last_error = $2,
               finished_at = now()
         WHERE id = $1
    `;
}

function firmwareUnitCountsSql(): string {
    return `
        SELECT
            COUNT(*) FILTER (WHERE status IN ('queued', 'in_progress'))::int AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM organization.firmware_units
         WHERE job_id = $1
           AND tenant_id = $2
    `;
}

function reclaimStaleFirmwareUnitsSql(): string {
    return `
        UPDATE organization.firmware_units
           SET status = 'failed',
               phase = 'failed',
               last_error = 'fm_restart_during_firmware_job',
               finished_at = now()
         WHERE status = 'in_progress'
           AND (picked_up_at IS NULL OR picked_up_at < now() - ($1 || ' ms')::interval)
     RETURNING id
    `;
}

function requireCallMethod(callMethod: CallMethod | undefined): CallMethod {
    if (!callMethod) throw new Error('job repository callMethod is not wired');
    return callMethod;
}

function readCreatedJobId(
    result: {rows?: unknown[]} | undefined,
    label: string
): string {
    const row = result?.rows?.[0] as {id?: unknown} | undefined;
    if (typeof row?.id !== 'string' || row.id.length === 0) {
        throw new Error(`${label} creation returned no id`);
    }
    return row.id;
}

function readCreatedBackupJob(
    result: {rows?: unknown[]} | undefined
): CreatedBackupJob {
    const row = result?.rows?.[0] as
        | {id?: unknown; created?: unknown}
        | undefined;
    if (typeof row?.id !== 'string' || row.id.length === 0) {
        throw new Error('backup_job creation returned no id');
    }
    return {
        jobId: row.id,
        created: row.created !== false
    };
}

function readCreatedFirmwareJob(
    result: {rows?: unknown[]} | undefined
): CreatedFirmwareJob {
    const row = result?.rows?.[0] as
        | {id?: unknown; created?: unknown}
        | undefined;
    if (typeof row?.id !== 'string' || row.id.length === 0) {
        throw new Error('firmware_job creation returned no id');
    }
    return {
        jobId: row.id,
        created: row.created !== false
    };
}

export function createJobRepository(
    queryRows: QueryRows,
    callMethod?: CallMethod
) {
    async function listActiveJobs(
        query: JobQuery
    ): Promise<OperationJobSnapshot[]> {
        const sql = activeJobsUnionSql(query.kinds);
        if (!sql) return [];
        const limit = normalizeLimit(query.limit);
        const rows = await queryRows<JobDbRow>(
            `
        SELECT *
          FROM (${sql}) jobs
         ORDER BY jobs.created_at DESC
         LIMIT $4
        `,
            [query.tenantId, ...ACTIVE_STATUSES, limit]
        );
        return rows.map(mapJobRow);
    }

    async function getJob(
        query: GetJobQuery
    ): Promise<OperationJobSnapshot | undefined> {
        for (const kind of getJobKinds(query.kind)) {
            const rows = await queryRows<JobDbRow>(getJobSql(kind), [
                query.tenantId,
                query.jobId
            ]);
            if (rows[0]) return mapJobRow(rows[0]);
        }
        return undefined;
    }

    async function finishJob(
        query: FinishJobQuery
    ): Promise<OperationJobSnapshot | undefined> {
        await queryRows(finishJobSql(query.kind), [
            query.status,
            query.jobId,
            query.tenantId
        ]);
        return getJob({
            tenantId: query.tenantId,
            jobId: query.jobId,
            kind: query.kind
        });
    }

    async function markJobRunning(
        query: MarkJobRunningQuery
    ): Promise<OperationJobSnapshot | undefined> {
        await queryRows(markJobRunningSql(query.kind), [
            query.jobId,
            query.tenantId
        ]);
        return getJob({
            tenantId: query.tenantId,
            jobId: query.jobId,
            kind: query.kind
        });
    }

    async function markCertificateUnit(
        query: MarkCertificateUnitQuery
    ): Promise<CertificatePushRow> {
        const rows = await queryRows<CertificatePushRow>(
            markCertificateUnitSql(),
            [query.status, query.lastError, query.requiresReboot, query.id]
        );
        return rows[0];
    }

    async function markCredentialUnit(
        query: MarkCredentialUnitQuery
    ): Promise<CredentialPushRow> {
        const rows = await queryRows<CredentialPushRow>(
            markCredentialUnitSql(),
            [query.status, query.lastError, query.id]
        );
        return rows[0];
    }

    async function listQueuedBackupUnits(
        query: ListQueuedBackupUnitsQuery
    ): Promise<BackupQueuedUnit[]> {
        const limit = normalizeLimit(query.limit);
        return await queryRows<BackupQueuedUnit>(selectQueuedBackupUnitsSql(), [
            limit
        ]);
    }

    async function markBackupUnitDone(
        query: MarkBackupUnitDoneQuery
    ): Promise<void> {
        await queryRows(markBackupUnitDoneSql(), [
            query.id,
            query.backupId ?? null,
            JSON.stringify(query.result ?? {})
        ]);
    }

    async function markBackupUnitFailed(
        query: MarkBackupUnitFailedQuery
    ): Promise<void> {
        await queryRows(markBackupUnitFailedSql(), [query.id, query.lastError]);
    }

    async function getBackupUnitCounts(
        query: GetBackupUnitCountsQuery
    ): Promise<BackupUnitCounts> {
        const rows = await queryRows<{
            pending: number | string | null;
            failed: number | string | null;
        }>(backupUnitCountsSql(), [query.jobId, query.tenantId]);
        return {
            pending: normalizeCount(rows[0]?.pending ?? 0),
            failed: normalizeCount(rows[0]?.failed ?? 0)
        };
    }

    async function backupCaptureOrgs(
        backupIds: string[]
    ): Promise<Map<string, string>> {
        const owners = await backupCaptureOwners(backupIds);
        const map = new Map<string, string>();
        for (const [backupId, owner] of owners) {
            map.set(backupId, owner.organizationId);
        }
        return map;
    }

    async function backupCaptureOwners(
        backupIds: string[]
    ): Promise<Map<string, BackupDeviceOwnership>> {
        if (backupIds.length === 0) return new Map();
        const rows = await queryRows<{
            backup_id: string;
            tenant_id: string;
            logical_device_id: number | null;
            snapshot_external_id: string;
            current_external_id: string | null;
            current_organization_id: string | null;
        }>(backupCaptureOwnersSql(), [backupIds]);
        const map = new Map<string, BackupDeviceOwnership>();
        for (const row of rows) {
            map.set(row.backup_id, {
                organizationId: row.tenant_id,
                device: {
                    id: row.logical_device_id,
                    external_id: row.snapshot_external_id
                },
                currentExternalId: row.current_external_id,
                currentOrganizationId: row.current_organization_id
            });
        }
        return map;
    }

    async function resolveBackupDeviceOwners(
        probes: BackupDeviceOwnershipProbe[]
    ): Promise<Map<string, BackupDeviceOwnership>> {
        if (probes.length === 0) return new Map();
        const rows = await queryRows<{
            backup_id: string;
            tenant_id: string;
            logical_device_id: number | null;
            snapshot_external_id: string;
            current_external_id: string | null;
            current_organization_id: string | null;
        }>(resolveBackupDeviceOwnersSql(), [
            JSON.stringify(
                probes.map((probe) => ({
                    backup_id: probe.backupId,
                    organization_id: probe.organizationId,
                    logical_device_id: probe.device.id,
                    snapshot_external_id: probe.device.external_id
                }))
            )
        ]);
        const map = new Map<string, BackupDeviceOwnership>();
        for (const row of rows) {
            map.set(row.backup_id, {
                organizationId: row.tenant_id,
                device: {
                    id: row.logical_device_id,
                    external_id: row.snapshot_external_id
                },
                currentExternalId: row.current_external_id,
                currentOrganizationId: row.current_organization_id
            });
        }
        return map;
    }

    async function reclaimStaleBackupUnits(
        query: ReclaimStaleBackupUnitsQuery
    ): Promise<number> {
        const rows = await queryRows<{id: number}>(
            reclaimStaleBackupUnitsSql(),
            [query.timeoutMs]
        );
        return rows.length;
    }

    async function listQueuedFirmwareUnits(
        query: ListQueuedFirmwareUnitsQuery
    ): Promise<FirmwareQueuedUnit[]> {
        const limit = normalizeLimit(query.limit);
        return await queryRows<FirmwareQueuedUnit>(
            selectQueuedFirmwareUnitsSql(),
            [limit]
        );
    }

    async function markFirmwareUnitProgress(
        query: MarkFirmwareUnitProgressQuery
    ): Promise<void> {
        await queryRows(markFirmwareUnitProgressSql(), [
            query.id,
            query.phase,
            query.progressPercent ?? null
        ]);
    }

    async function markFirmwareUnitDone(
        query: MarkFirmwareUnitDoneQuery
    ): Promise<void> {
        await queryRows(markFirmwareUnitDoneSql(), [
            query.id,
            query.finalVersion ?? null,
            query.finalFwId ?? null,
            JSON.stringify(query.result ?? {})
        ]);
    }

    async function markFirmwareUnitFailed(
        query: MarkFirmwareUnitFailedQuery
    ): Promise<void> {
        await queryRows(markFirmwareUnitFailedSql(), [
            query.id,
            query.lastError
        ]);
    }

    async function getFirmwareUnitCounts(
        query: GetFirmwareUnitCountsQuery
    ): Promise<FirmwareUnitCounts> {
        const rows = await queryRows<{
            pending: number | string | null;
            failed: number | string | null;
        }>(firmwareUnitCountsSql(), [query.jobId, query.tenantId]);
        return {
            pending: normalizeCount(rows[0]?.pending ?? 0),
            failed: normalizeCount(rows[0]?.failed ?? 0)
        };
    }

    async function reclaimStaleFirmwareUnits(
        query: ReclaimStaleFirmwareUnitsQuery
    ): Promise<number> {
        const rows = await queryRows<{id: number}>(
            reclaimStaleFirmwareUnitsSql(),
            [query.timeoutMs]
        );
        return rows.length;
    }

    async function createCertificateJob(
        query: CreateCertificateJobQuery
    ): Promise<string> {
        const result = await requireCallMethod(callMethod)(
            'organization.fn_certificate_job_create',
            {
                p_tenant_id: query.tenantId,
                p_certificate_id: query.certificateId,
                p_slot: query.slot,
                p_target: JSON.stringify(query.target),
                p_created_by: query.createdBy
            }
        );
        return readCreatedJobId(result, 'certificate_job');
    }

    async function enqueueCertificateTargets(
        query: EnqueueCertificateTargetsQuery
    ): Promise<void> {
        await requireCallMethod(callMethod)(
            'organization.fn_certificate_push_enqueue_batch',
            {
                p_job_id: query.jobId,
                p_tenant_id: query.tenantId,
                p_certificate_id: query.certificateId,
                p_slot: query.slot,
                p_device_ids: query.deviceIds
            }
        );
    }

    async function createCredentialJob(
        query: CreateCredentialJobQuery
    ): Promise<string> {
        const result = await requireCallMethod(callMethod)(
            'organization.fn_credential_job_create',
            {
                p_tenant_id: query.tenantId,
                p_target: JSON.stringify(query.target),
                p_mode: query.mode,
                p_created_by: query.createdBy
            }
        );
        return readCreatedJobId(result, 'credential_job');
    }

    async function createBackupJob(
        query: CreateBackupJobQuery
    ): Promise<CreatedBackupJob> {
        const result = await requireCallMethod(callMethod)(
            'organization.fn_backup_job_create',
            {
                p_tenant_id: query.tenantId,
                p_target: JSON.stringify(query.target),
                p_mode: query.mode,
                p_created_by: query.createdBy,
                p_idempotency_key: query.idempotencyKey ?? null,
                p_request_hash: query.requestHash
            }
        );
        return readCreatedBackupJob(result);
    }

    async function enqueueBackupTargets(
        query: EnqueueBackupTargetsQuery
    ): Promise<void> {
        await requireCallMethod(callMethod)(
            'organization.fn_backup_unit_enqueue_batch',
            {
                p_job_id: query.jobId,
                p_tenant_id: query.tenantId,
                p_device_ids: query.deviceIds
            }
        );
    }

    async function createFirmwareJob(
        query: CreateFirmwareJobQuery
    ): Promise<CreatedFirmwareJob> {
        const result = await requireCallMethod(callMethod)(
            'organization.fn_firmware_job_create',
            {
                p_tenant_id: query.tenantId,
                p_target: JSON.stringify(query.target),
                p_mode: query.mode,
                p_created_by: query.createdBy,
                p_idempotency_key: query.idempotencyKey ?? null,
                p_request_hash: query.requestHash
            }
        );
        return readCreatedFirmwareJob(result);
    }

    async function enqueueFirmwareTargets(
        query: EnqueueFirmwareTargetsQuery
    ): Promise<void> {
        await requireCallMethod(callMethod)(
            'organization.fn_firmware_unit_enqueue_batch',
            {
                p_job_id: query.jobId,
                p_tenant_id: query.tenantId,
                p_device_ids: query.deviceIds,
                p_request: JSON.stringify(query.request)
            }
        );
    }

    return {
        listActiveJobs,
        getJob,
        markJobRunning,
        markCertificateUnit,
        markCredentialUnit,
        listQueuedBackupUnits,
        markBackupUnitDone,
        markBackupUnitFailed,
        getBackupUnitCounts,
        backupCaptureOrgs,
        backupCaptureOwners,
        resolveBackupDeviceOwners,
        reclaimStaleBackupUnits,
        listQueuedFirmwareUnits,
        markFirmwareUnitProgress,
        markFirmwareUnitDone,
        markFirmwareUnitFailed,
        getFirmwareUnitCounts,
        reclaimStaleFirmwareUnits,
        finishJob,
        createCertificateJob,
        enqueueCertificateTargets,
        createCredentialJob,
        createBackupJob,
        enqueueBackupTargets,
        createFirmwareJob,
        enqueueFirmwareTargets
    };
}
