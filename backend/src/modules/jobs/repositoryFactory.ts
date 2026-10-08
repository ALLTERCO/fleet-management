import type {AssignmentScope} from '../../types/api/assignment';
import type {
    CertificatePushRow,
    CertificatePushStatus
} from '../../types/api/certificate';
import type {
    OperationJobControlSnapshot,
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
    authority: JobAuthority;
    execution_id: string;
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
    authority: JobAuthority;
    execution_id: string;
}

export interface UserJobAuthority {
    kind: 'user';
    tenantId: string;
    userId: string;
    username?: string;
    credentialId?: string;
    credentialBoundary?: AssignmentScope;
    operation: 'update' | 'execute';
    sourceIp?: string;
}

export interface SystemJobAuthority {
    kind: 'system';
    tenantId: string;
    service: 'firmware-auto-update';
    channel: 'stable' | 'beta';
}

export type JobAuthority = UserJobAuthority | SystemJobAuthority;

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
    control_state?: string | null;
    queued_count?: number | string | null;
    claimed_count?: number | string | null;
    dispatched_count?: number | string | null;
    stopped_count?: number | string | null;
    unresolved_count?: number | string | null;
    cancel_requested_at?: Date | string | null;
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
    authority: JobAuthority;
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
    authority: JobAuthority;
}

interface CreateBackupJobQuery {
    tenantId: string;
    target: unknown;
    mode: 'create' | 'restore';
    createdBy: string;
    idempotencyKey?: string;
    requestHash: string;
    authority: JobAuthority;
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
    authority: JobAuthority;
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
    executionId: string;
}

interface MarkCredentialUnitQuery {
    id: number;
    status: 'ok' | 'failed' | 'unknown';
    lastError: string | null;
    executionId: string;
}

interface ListQueuedBackupUnitsQuery {
    limit: number;
}

interface MarkBackupUnitDoneQuery {
    id: number;
    executionId: string;
    backupId?: string;
    result?: unknown;
}

interface MarkBackupUnitFailedQuery {
    id: number;
    executionId: string;
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
    executionId: string;
    phase: string;
    progressPercent?: number;
}

interface MarkFirmwareUnitDoneQuery {
    id: number;
    executionId: string;
    finalVersion?: string;
    finalFwId?: string;
    result?: unknown;
}

interface MarkFirmwareUnitFailedQuery {
    id: number;
    executionId: string;
    lastError: string;
}

interface GetFirmwareUnitCountsQuery {
    tenantId: string;
    jobId: string;
}

interface ReclaimStaleFirmwareUnitsQuery {
    timeoutMs: number;
}

interface PrepareUnitDispatchQuery {
    kind: OperationJobKind;
    id: number;
    executionId: string;
}

interface StopUnitBeforeDispatchQuery extends PrepareUnitDispatchQuery {
    reason: string;
}

interface ControlJobQuery {
    tenantId: string;
    jobId: string;
    kind: OperationJobKind;
}

export interface JobControlContext {
    authority?: JobAuthority;
    deviceIds: string[];
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
    const snapshot: OperationJobSnapshot = {
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
    if (row.control_state) {
        snapshot.control = {
            state: row.control_state as OperationJobControlSnapshot['state'],
            queuedCount: normalizeCount(row.queued_count ?? 0),
            claimedCount: normalizeCount(row.claimed_count ?? 0),
            dispatchedCount: normalizeCount(row.dispatched_count ?? 0),
            stoppedCount: normalizeCount(row.stopped_count ?? 0),
            unresolvedCount: normalizeCount(row.unresolved_count ?? 0),
            cancelRequestedAt: toIsoString(row.cancel_requested_at ?? null)
        };
    }
    return snapshot;
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

// UNION ALL matches columns by position, so every kind select uses this one order.
const JOB_SELECT_COLUMNS = [
    'id',
    'kind',
    'status',
    'total',
    'done_count',
    'fail_count',
    'created_at',
    'started_at',
    'ended_at',
    'created_by',
    'metadata',
    'control_state',
    'queued_count',
    'claimed_count',
    'dispatched_count',
    'stopped_count',
    'unresolved_count',
    'cancel_requested_at'
] as const satisfies readonly (keyof JobDbRow)[];

type JobSelectColumn = (typeof JOB_SELECT_COLUMNS)[number];

interface JobKindSelect {
    columns: Record<JobSelectColumn, string>;
    from: string;
    extraGroupBy: readonly string[];
}

const SHARED_JOB_COLUMNS = {
    id: 'j.id::text',
    status: 'j.status::text',
    created_at: 'j.created_at',
    started_at: 'j.started_at',
    ended_at: 'j.finished_at',
    created_by: 'j.created_by::text',
    control_state: 'j.control_state',
    cancel_requested_at: 'j.cancel_requested_at'
} as const;

const SHARED_JOB_GROUP_BY = [
    'j.id',
    'j.status',
    'j.created_at',
    'j.started_at',
    'j.finished_at',
    'j.created_by',
    'j.control_state',
    'j.cancel_requested_at'
] as const;

function pushJobSelect(
    kind: 'certificate' | 'credential',
    doneStatuses: string,
    failStatuses: string,
    metadata: string,
    extraGroupBy: readonly string[]
): JobKindSelect {
    return {
        columns: {
            ...SHARED_JOB_COLUMNS,
            kind: `'${kind}'::text`,
            total: 'count(p.id)::int',
            done_count: `count(p.id) FILTER (WHERE p.status IN (${doneStatuses}))::int`,
            fail_count: `count(p.id) FILTER (WHERE p.status IN (${failStatuses}))::int`,
            metadata,
            queued_count:
                "count(p.id) FILTER (WHERE p.outcome_state = 'active' AND p.dispatch_state = 'queued')::int",
            claimed_count:
                "count(p.id) FILTER (WHERE p.outcome_state = 'active' AND p.dispatch_state = 'claimed')::int",
            dispatched_count:
                "count(p.id) FILTER (WHERE p.dispatch_state = 'dispatched')::int",
            stopped_count:
                "count(p.id) FILTER (WHERE p.outcome_state = 'stopped')::int",
            unresolved_count:
                "count(p.id) FILTER (WHERE p.outcome_state = 'unknown')::int"
        },
        from: `organization.${kind}_jobs j
          LEFT JOIN organization.${kind}_pushes p ON p.job_id = j.id`,
        extraGroupBy
    };
}

function unitActiveCountSql(dispatchState: string): string {
    return `count(u.id) FILTER (
                WHERE u.outcome_state = 'active' AND u.status IN ('queued', 'in_progress')
                  AND u.dispatch_state = '${dispatchState}'
            )::int`;
}

function unitJobSelect(kind: 'backup' | 'firmware'): JobKindSelect {
    return {
        columns: {
            ...SHARED_JOB_COLUMNS,
            kind: `'${kind}'::text`,
            total: 'count(u.id)::int',
            done_count: "count(u.id) FILTER (WHERE u.status = 'done')::int",
            fail_count: "count(u.id) FILTER (WHERE u.status = 'failed')::int",
            metadata: `jsonb_build_object(
                'mode', j.mode,
                'targetSummary', j.target_summary,
                'lastError', j.last_error
            )`,
            queued_count: unitActiveCountSql('queued'),
            claimed_count: unitActiveCountSql('claimed'),
            dispatched_count: unitActiveCountSql('dispatched'),
            stopped_count:
                "count(u.id) FILTER (WHERE u.outcome_state = 'stopped')::int",
            unresolved_count:
                "count(u.id) FILTER (WHERE u.outcome_state = 'unknown')::int"
        },
        from: `organization.${kind}_jobs j
          LEFT JOIN organization.${kind}_units u ON u.job_id = j.id`,
        extraGroupBy: ['j.mode', 'j.target_summary', 'j.last_error']
    };
}

const JOB_KIND_SELECTS: Record<OperationJobKind, JobKindSelect> = {
    certificate: pushJobSelect(
        'certificate',
        "'applied'",
        "'failed', 'rolled_back'",
        `jsonb_build_object(
                'certificateId', j.certificate_id::text,
                'slot', j.slot,
                'targetSummary', j.target_summary
            )`,
        ['j.certificate_id', 'j.slot', 'j.target_summary']
    ),
    credential: pushJobSelect(
        'credential',
        "'ok'",
        "'failed', 'unknown'",
        `jsonb_build_object(
                'mode', j.mode,
                'targetSummary', j.target_summary
            )`,
        ['j.mode', 'j.target_summary']
    ),
    backup: unitJobSelect('backup'),
    firmware: unitJobSelect('firmware')
};

function jobsSqlFor(kind: OperationJobKind, statusFilter: string): string {
    const select = JOB_KIND_SELECTS[kind];
    const columns = JOB_SELECT_COLUMNS.map(
        (column) => `${select.columns[column]} AS ${column}`
    ).join(',\n            ');
    const groupBy = [...SHARED_JOB_GROUP_BY, ...select.extraGroupBy].join(
        ',\n            '
    );
    return `
        SELECT
            ${columns}
          FROM ${select.from}
         WHERE j.tenant_id = $1
           ${statusFilter}
         GROUP BY
            ${groupBy}
    `;
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
    const controlUpdate = `, control_state = CASE
                   WHEN EXISTS (
                       SELECT 1 FROM ${controlledUnitTable(kind)} unit
                        WHERE unit.job_id = ${jobTable(kind)}.id
                          AND unit.outcome_state IN ('stopped', 'unknown')
                   ) THEN 'stopped'
                   ELSE 'completed'
               END`;
    return `
        UPDATE ${jobTable(kind)}
           SET status = $1,
               finished_at = now()
               ${controlUpdate}
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
           AND execution_id = $5
           AND outcome_state = 'active'
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
           AND execution_id = $4
           AND outcome_state = 'active'
     RETURNING id, job_id::text, device_id, status, last_error
    `;
}

function selectQueuedBackupUnitsSql(): string {
    return `
        WITH job_service AS MATERIALIZED (
              SELECT job_id, MAX(picked_up_at) AS last_picked
                FROM organization.backup_units
               GROUP BY job_id
        ), ranked AS MATERIALIZED (
              SELECT u.id,
                     u.job_id,
                     u.logical_device_id,
                     ROW_NUMBER() OVER (
                         PARTITION BY u.job_id ORDER BY u.id
                     ) AS job_rank,
                     service.last_picked AS job_last_picked
                FROM organization.backup_units u
                JOIN organization.backup_jobs j ON j.id = u.job_id
                JOIN job_service service ON service.job_id = u.job_id
               WHERE u.status = 'queued'
                 AND j.status IN ('queued', 'running')
                 AND j.control_state = 'active'
                 AND u.outcome_state = 'active'
                 AND u.dispatch_state = 'queued'
                 AND u.logical_device_id IS NOT NULL
        ), candidates AS MATERIALIZED (
              SELECT id, logical_device_id
                FROM ranked
               ORDER BY job_rank,
                        job_last_picked ASC NULLS FIRST,
                        job_id,
                        id
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
                JOIN organization.backup_jobs job ON job.id = unit.job_id
               WHERE unit.status = 'queued'
                 AND job.control_state = 'active'
               FOR UPDATE OF unit, job SKIP LOCKED
        ), claimed AS (
              UPDATE organization.backup_units unit
                 SET status = 'in_progress',
                     phase = 'running',
                     picked_up_at = now(),
                     execution_id = gen_random_uuid(),
                     dispatch_state = 'claimed'
                FROM claimable
               WHERE unit.id = claimable.id
           RETURNING unit.id,
                     unit.job_id,
                     unit.tenant_id,
                     unit.execution_id,
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
               job.authority
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
           AND execution_id = $4
           AND outcome_state = 'active'
     RETURNING id
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
           AND execution_id = $3
           AND outcome_state = 'active'
     RETURNING id
    `;
}

function backupUnitCountsSql(): string {
    return `
        SELECT
            COUNT(*) FILTER (
                WHERE outcome_state = 'active' AND status IN ('queued', 'in_progress')
            )::int AS pending,
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
           SET outcome_state = CASE
                   WHEN dispatch_state = 'dispatched' THEN 'unknown'
                   ELSE 'stopped'
               END,
               phase = CASE
                   WHEN dispatch_state = 'dispatched' THEN 'unknown'
                   ELSE 'stopped'
               END,
               last_error = CASE
                   WHEN dispatch_state = 'dispatched' THEN 'fm_restart_after_backup_dispatch'
                   ELSE 'fm_restart_before_backup_dispatch'
               END,
               finished_at = now()
         WHERE status = 'in_progress'
           AND (picked_up_at IS NULL OR picked_up_at < now() - ($1 || ' ms')::interval)
     RETURNING id
    `;
}

function selectQueuedFirmwareUnitsSql(): string {
    return `
        WITH job_service AS MATERIALIZED (
              SELECT job_id, MAX(picked_up_at) AS last_picked
                FROM organization.firmware_units
               GROUP BY job_id
        ), ranked AS MATERIALIZED (
              SELECT u.id,
                     u.job_id,
                     u.logical_device_id,
                     ROW_NUMBER() OVER (
                         PARTITION BY u.job_id ORDER BY u.id
                     ) AS job_rank,
                     service.last_picked AS job_last_picked
                FROM organization.firmware_units u
                JOIN organization.firmware_jobs j ON j.id = u.job_id
                JOIN job_service service ON service.job_id = u.job_id
               WHERE u.status = 'queued'
                 AND j.status IN ('queued', 'running')
                 AND j.control_state = 'active'
                 AND u.outcome_state = 'active'
                 AND u.dispatch_state = 'queued'
                 AND u.logical_device_id IS NOT NULL
        ), candidates AS MATERIALIZED (
              SELECT id, logical_device_id
                FROM ranked
               ORDER BY job_rank,
                        job_last_picked ASC NULLS FIRST,
                        job_id,
                        id
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
                JOIN organization.firmware_jobs job ON job.id = unit.job_id
               WHERE unit.status = 'queued'
                 AND job.control_state = 'active'
               FOR UPDATE OF unit, job SKIP LOCKED
        ), claimed AS (
              UPDATE organization.firmware_units unit
                 SET status = 'in_progress',
                     phase = 'starting',
                     picked_up_at = now(),
                     execution_id = gen_random_uuid(),
                     dispatch_state = 'claimed'
                FROM claimable
               WHERE unit.id = claimable.id
           RETURNING unit.id,
                     unit.job_id,
                     unit.tenant_id,
                     unit.request,
                     unit.execution_id,
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
               claimed.request,
               job.authority
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
           AND execution_id = $4
           AND outcome_state = 'active'
     RETURNING id
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
           AND execution_id = $5
           AND outcome_state = 'active'
     RETURNING id
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
           AND execution_id = $3
           AND outcome_state = 'active'
     RETURNING id
    `;
}

function firmwareUnitCountsSql(): string {
    return `
        SELECT
            COUNT(*) FILTER (
                WHERE outcome_state = 'active' AND status IN ('queued', 'in_progress')
            )::int AS pending,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
          FROM organization.firmware_units
         WHERE job_id = $1
           AND tenant_id = $2
    `;
}

function reclaimStaleFirmwareUnitsSql(): string {
    return `
        UPDATE organization.firmware_units
           SET outcome_state = CASE
                   WHEN dispatch_state = 'dispatched' THEN 'unknown'
                   ELSE 'stopped'
               END,
               phase = CASE
                   WHEN dispatch_state = 'dispatched' THEN 'unknown'
                   ELSE 'stopped'
               END,
               last_error = CASE
                   WHEN dispatch_state = 'dispatched' THEN 'fm_restart_after_firmware_dispatch'
                   ELSE 'fm_restart_before_firmware_dispatch'
               END,
               finished_at = now()
         WHERE status = 'in_progress'
           AND (picked_up_at IS NULL OR picked_up_at < now() - ($1 || ' ms')::interval)
     RETURNING id
    `;
}

function controlledUnitTable(kind: OperationJobKind): string {
    if (kind === 'certificate') return 'organization.certificate_pushes';
    if (kind === 'credential') return 'organization.credential_pushes';
    return kind === 'backup'
        ? 'organization.backup_units'
        : 'organization.firmware_units';
}

function stopUnitBeforeDispatchSql(kind: OperationJobKind): string {
    const phaseUpdate =
        kind === 'backup' || kind === 'firmware' ? ", phase = 'stopped'" : '';
    return `
        UPDATE ${controlledUnitTable(kind)}
           SET outcome_state = 'stopped',
               last_error = $3
               ${phaseUpdate},
               finished_at = now()
         WHERE id = $1
           AND execution_id = $2
           AND dispatch_state = 'claimed'
           AND outcome_state = 'active'
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
    ): Promise<CertificatePushRow | undefined> {
        const rows = await queryRows<CertificatePushRow>(
            markCertificateUnitSql(),
            [
                query.status,
                query.lastError,
                query.requiresReboot,
                query.id,
                query.executionId
            ]
        );
        return rows[0];
    }

    async function markCredentialUnit(
        query: MarkCredentialUnitQuery
    ): Promise<CredentialPushRow | undefined> {
        const rows = await queryRows<CredentialPushRow>(
            markCredentialUnitSql(),
            [query.status, query.lastError, query.id, query.executionId]
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
    ): Promise<boolean> {
        const rows = await queryRows<{id: number}>(markBackupUnitDoneSql(), [
            query.id,
            query.backupId ?? null,
            JSON.stringify(query.result ?? {}),
            query.executionId
        ]);
        return rows.length === 1;
    }

    async function markBackupUnitFailed(
        query: MarkBackupUnitFailedQuery
    ): Promise<boolean> {
        const rows = await queryRows<{id: number}>(markBackupUnitFailedSql(), [
            query.id,
            query.lastError,
            query.executionId
        ]);
        return rows.length === 1;
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
    ): Promise<boolean> {
        const rows = await queryRows<{id: number}>(
            markFirmwareUnitProgressSql(),
            [
                query.id,
                query.phase,
                query.progressPercent ?? null,
                query.executionId
            ]
        );
        return rows.length === 1;
    }

    async function markFirmwareUnitDone(
        query: MarkFirmwareUnitDoneQuery
    ): Promise<boolean> {
        const rows = await queryRows<{id: number}>(markFirmwareUnitDoneSql(), [
            query.id,
            query.finalVersion ?? null,
            query.finalFwId ?? null,
            JSON.stringify(query.result ?? {}),
            query.executionId
        ]);
        return rows.length === 1;
    }

    async function markFirmwareUnitFailed(
        query: MarkFirmwareUnitFailedQuery
    ): Promise<boolean> {
        const rows = await queryRows<{id: number}>(
            markFirmwareUnitFailedSql(),
            [query.id, query.lastError, query.executionId]
        );
        return rows.length === 1;
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
            'organization.fn_certificate_job_create_authorized',
            {
                p_tenant_id: query.tenantId,
                p_certificate_id: query.certificateId,
                p_slot: query.slot,
                p_target: JSON.stringify(query.target),
                p_created_by: query.createdBy,
                p_authority: JSON.stringify(query.authority)
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
            'organization.fn_credential_job_create_authorized',
            {
                p_tenant_id: query.tenantId,
                p_target: JSON.stringify(query.target),
                p_mode: query.mode,
                p_created_by: query.createdBy,
                p_authority: JSON.stringify(query.authority)
            }
        );
        return readCreatedJobId(result, 'credential_job');
    }

    async function createBackupJob(
        query: CreateBackupJobQuery
    ): Promise<CreatedBackupJob> {
        const result = await requireCallMethod(callMethod)(
            'organization.fn_backup_job_create_authorized',
            {
                p_tenant_id: query.tenantId,
                p_target: JSON.stringify(query.target),
                p_mode: query.mode,
                p_created_by: query.createdBy,
                p_idempotency_key: query.idempotencyKey ?? null,
                p_request_hash: query.requestHash,
                p_authority: JSON.stringify(query.authority)
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
            'organization.fn_firmware_job_create_authorized',
            {
                p_tenant_id: query.tenantId,
                p_target: JSON.stringify(query.target),
                p_mode: query.mode,
                p_created_by: query.createdBy,
                p_idempotency_key: query.idempotencyKey ?? null,
                p_request_hash: query.requestHash,
                p_authority: JSON.stringify(query.authority)
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

    async function prepareUnitDispatch(
        query: PrepareUnitDispatchQuery
    ): Promise<boolean> {
        const extended =
            query.kind === 'certificate' || query.kind === 'credential';
        const method = extended
            ? 'fm.fn_extended_job_prepare_dispatch'
            : 'fm.fn_job_prepare_dispatch';
        const result = await requireCallMethod(callMethod)(method, {
            p_kind: query.kind,
            p_unit_id: query.id,
            p_execution_id: query.executionId
        });
        return (
            (result?.rows?.[0] as Record<string, boolean> | undefined)?.[
                extended
                    ? 'fn_extended_job_prepare_dispatch'
                    : 'fn_job_prepare_dispatch'
            ] === true
        );
    }

    async function cancelJob(query: ControlJobQuery): Promise<boolean> {
        const extended =
            query.kind === 'certificate' || query.kind === 'credential';
        const method = extended
            ? 'fm.fn_extended_job_cancel'
            : 'fm.fn_job_cancel';
        const result = await requireCallMethod(callMethod)(method, {
            p_kind: query.kind,
            p_tenant_id: query.tenantId,
            p_job_id: query.jobId
        });
        return (
            (result?.rows?.[0] as Record<string, boolean> | undefined)?.[
                extended ? 'fn_extended_job_cancel' : 'fn_job_cancel'
            ] === true
        );
    }

    async function stopUnitBeforeDispatch(
        query: StopUnitBeforeDispatchQuery
    ): Promise<boolean> {
        const rows = await queryRows<{id: number}>(
            stopUnitBeforeDispatchSql(query.kind),
            [query.id, query.executionId, query.reason]
        );
        return rows.length === 1;
    }

    async function resumeJob(query: ControlJobQuery): Promise<boolean> {
        const extended =
            query.kind === 'certificate' || query.kind === 'credential';
        const method = extended
            ? 'fm.fn_extended_job_resume'
            : 'fm.fn_job_resume';
        const result = await requireCallMethod(callMethod)(method, {
            p_kind: query.kind,
            p_tenant_id: query.tenantId,
            p_job_id: query.jobId
        });
        return (
            (result?.rows?.[0] as Record<string, boolean> | undefined)?.[
                extended ? 'fn_extended_job_resume' : 'fn_job_resume'
            ] === true
        );
    }

    async function getJobControlContext(
        query: ControlJobQuery
    ): Promise<JobControlContext | undefined> {
        const rows = await queryRows<{
            authority: JobAuthority;
            device_ids: unknown;
        }>(
            `SELECT job.authority,
                    jsonb_agg(unit.device_id ORDER BY unit.id) AS device_ids
               FROM ${jobTable(query.kind)} job
               LEFT JOIN ${controlledUnitTable(query.kind)} unit
                 ON unit.job_id = job.id
              WHERE job.id = $1 AND job.tenant_id = $2
              GROUP BY job.id, job.authority
              LIMIT 1`,
            [query.jobId, query.tenantId]
        );
        const row = rows[0];
        if (!row) return undefined;
        const deviceIds = Array.isArray(row.device_ids)
            ? row.device_ids.filter(
                  (value): value is string => typeof value === 'string'
              )
            : [];
        return {
            ...(row.authority ? {authority: row.authority} : {}),
            deviceIds
        };
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
        enqueueFirmwareTargets,
        prepareUnitDispatch,
        stopUnitBeforeDispatch,
        cancelJob,
        resumeJob,
        getJobControlContext
    };
}
