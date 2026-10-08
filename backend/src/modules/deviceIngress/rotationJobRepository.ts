import {totalFromRows} from '../../rpc/listResponse';
import {iso, isoOrNull} from '../util/iso';
import {
    activatePendingCredential,
    createCredential,
    type DeviceIngressRepositoryDeps,
    type DeviceIngressTransactionDeps,
    type DeviceIngressTx,
    type ListPage
} from './deviceIngressRepository';
import type {RotationJobErrorCode, RotationJobState} from './rotationJobState';
import type {CreateTokenCredentialRepository} from './tokenCredentials';

export interface RotationJob {
    id: string;
    organizationId: string;
    batchId: string;
    identityId: string;
    oldCredentialId: string;
    newCredentialId: string | null;
    state: RotationJobState;
    errorCode: RotationJobErrorCode | null;
    sentAt: string | null;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    // Null when the identity row is gone, or when the query did not join it.
    expectedExternalId: string | null;
}

export interface RotationCandidate {
    identityId: string;
    identityStatus: string | null;
    activeTokenCredentialId: string | null;
    hasOpenJob: boolean;
}

interface JobRow {
    id: string;
    organization_id: string;
    batch_id: string;
    identity_id: string;
    old_credential_id: string;
    new_credential_id: string | null;
    state: RotationJobState;
    error_code: RotationJobErrorCode | null;
    sent_at: Date | string | null;
    created_by: string;
    created_at: Date | string;
    updated_at: Date | string;
    expected_external_id?: string | null;
    total_count?: number;
}

const JOB_COLUMNS = `id, organization_id, batch_id, identity_id, old_credential_id,
    new_credential_id, state, error_code, sent_at, created_by, created_at, updated_at`;

const JOB_COLUMNS_ALIASED = JOB_COLUMNS.split(',')
    .map((column) => `j.${column.trim()}`)
    .join(', ');

// The device id lives on the identity, so a job can name its device alone.
const IDENTITY_JOIN = `LEFT JOIN organization.device_ingress_identity i
             ON i.id = j.identity_id AND i.organization_id = j.organization_id`;

const defaultDeps: DeviceIngressTransactionDeps = {
    async queryRows<T>(
        sql: string,
        params: readonly unknown[] = []
    ): Promise<T[]> {
        // Deliberate lazy import: PostgresProvider loads runtime config.
        const postgres = await import('../PostgresProvider.js');
        return postgres.queryRows<T>(sql, params);
    },
    async transaction<T>(fn: (tx: DeviceIngressTx) => Promise<T>): Promise<T> {
        // Deliberate lazy import: PostgresProvider loads runtime config.
        const postgres = await import('../PostgresProvider.js');
        return postgres.withQueryTransaction((client) =>
            fn({
                queryRows: <R>(sql: string, params?: readonly unknown[]) =>
                    client.query<R>(sql, params)
            })
        );
    }
};

function toJob(row: JobRow): RotationJob {
    return {
        id: row.id,
        organizationId: row.organization_id,
        batchId: row.batch_id,
        identityId: row.identity_id,
        oldCredentialId: row.old_credential_id,
        newCredentialId: row.new_credential_id,
        state: row.state,
        errorCode: row.error_code,
        sentAt: isoOrNull(row.sent_at),
        createdBy: row.created_by,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        expectedExternalId: row.expected_external_id ?? null
    };
}

export async function findRotationCandidates(
    input: {organizationId: string; identityIds: string[]},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationCandidate[]> {
    const rows = await deps.queryRows<{
        identity_id: string;
        identity_status: string | null;
        active_token_credential_id: string | null;
        has_open_job: boolean;
    }>(
        `SELECT wanted.id AS identity_id,
                i.status AS identity_status,
                -- The active token key if one exists, else the newest pending
                -- one (e.g. a Setup.Plan key never yet rotated). Callers still
                -- treat this as "the current key" (oldCredentialId) even when
                -- it is pending.
                COALESCE(
                    (SELECT c.id FROM organization.device_ingress_credential c
                      WHERE c.identity_id = wanted.id AND c.organization_id = $1
                        AND c.credential_type = 'token' AND c.state = 'active'
                      LIMIT 1),
                    (SELECT c.id FROM organization.device_ingress_credential c
                      WHERE c.identity_id = wanted.id AND c.organization_id = $1
                        AND c.credential_type = 'token' AND c.state = 'pending'
                      ORDER BY c.created_at DESC
                      LIMIT 1)
                ) AS active_token_credential_id,
                EXISTS (SELECT 1 FROM organization.device_ingress_rotation_job j
                         WHERE j.identity_id = wanted.id
                           AND j.organization_id = $1
                           AND j.state IN ('queued', 'sent', 'waiting')) AS has_open_job
           FROM unnest($2::uuid[]) AS wanted(id)
           LEFT JOIN organization.device_ingress_identity i
             ON i.id = wanted.id AND i.organization_id = $1`,
        [input.organizationId, input.identityIds]
    );
    return rows.map((row) => ({
        identityId: row.identity_id,
        identityStatus: row.identity_status,
        activeTokenCredentialId: row.active_token_credential_id,
        hasOpenJob: row.has_open_job
    }));
}

export async function createRotationBatch(
    input: {
        organizationId: string;
        batchId: string;
        createdBy: string;
        jobs: Array<{identityId: string; oldCredentialId: string}>;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob[]> {
    const rows = await deps.queryRows<JobRow>(
        `INSERT INTO organization.device_ingress_rotation_job (
            organization_id, batch_id, created_by, identity_id, old_credential_id
        )
        SELECT $1, $2, $3, identity_id, old_credential_id
          FROM unnest($4::uuid[], $5::uuid[]) AS j(identity_id, old_credential_id)
        RETURNING ${JOB_COLUMNS}`,
        [
            input.organizationId,
            input.batchId,
            input.createdBy,
            input.jobs.map((job) => job.identityId),
            input.jobs.map((job) => job.oldCredentialId)
        ]
    );
    return rows.map(toJob);
}

export async function claimQueuedJobs(
    input: {limit: number; staleClaimMs: number},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob[]> {
    const rows = await deps.queryRows<JobRow>(
        `WITH picked AS (
            SELECT id FROM organization.device_ingress_rotation_job
             WHERE state = 'queued'
               AND (claimed_at IS NULL OR claimed_at < now() - ($2 || ' ms')::interval)
             ORDER BY created_at ASC, id ASC
             LIMIT $1
             FOR UPDATE SKIP LOCKED
        )
        UPDATE organization.device_ingress_rotation_job j
           SET claimed_at = now(), updated_at = now()
          FROM picked
         WHERE j.id = picked.id
        RETURNING ${JOB_COLUMNS_ALIASED}`,
        [input.limit, input.staleClaimMs]
    );
    return rows.map(toJob);
}

export async function setJobState(
    input: {
        id: string;
        from: RotationJobState;
        to: RotationJobState;
        errorCode?: RotationJobErrorCode;
        markSent?: boolean;
        newCredentialId?: string;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob | null> {
    const rows = await deps.queryRows<JobRow>(
        `UPDATE organization.device_ingress_rotation_job
            SET state = $3,
                error_code = COALESCE($4, error_code),
                sent_at = CASE WHEN $5 THEN now() ELSE sent_at END,
                new_credential_id = COALESCE($6, new_credential_id),
                updated_at = now()
          -- Only the state the caller saw may move; a racing hook is never overwritten.
          WHERE id = $1 AND state = $2
          RETURNING ${JOB_COLUMNS}`,
        [
            input.id,
            input.from,
            input.to,
            input.errorCode ?? null,
            input.markSent ?? false,
            input.newCredentialId ?? null
        ]
    );
    return rows[0] ? toJob(rows[0]) : null;
}

// Key and job link commit together before the send, so a crash never orphans a key.
export function recordJobCredential<
    C extends {id: string; organizationId: string; identityId: string}
>(
    input: {
        jobId: string;
        mint: (repository: CreateTokenCredentialRepository) => Promise<C>;
    },
    deps: DeviceIngressTransactionDeps = defaultDeps
): Promise<C | null> {
    return deps.transaction(async (tx) => {
        const claimed = await tx.queryRows<{id: string}>(
            `SELECT id FROM organization.device_ingress_rotation_job
              WHERE id = $1 AND state = 'queued' AND new_credential_id IS NULL
              FOR UPDATE`,
            [input.jobId]
        );
        if (!claimed[0]) return null;
        const credential = await input.mint({
            createCredential: (credentialInput) =>
                createCredential(credentialInput, tx)
        });
        const linked = await tx.queryRows<{id: string}>(
            `UPDATE organization.device_ingress_rotation_job
                SET new_credential_id = $2, updated_at = now()
              WHERE id = $1 AND organization_id = $3 AND identity_id = $4
              RETURNING id`,
            [
                input.jobId,
                credential.id,
                credential.organizationId,
                credential.identityId
            ]
        );
        if (!linked[0]) {
            throw new Error(
                `rotation job ${input.jobId} does not own the minted key's identity`
            );
        }
        return credential;
    });
}

// Resumed as sent: the device's next handshake shows which key it holds.
export async function resumeRecordedJob(
    input: {id: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob | null> {
    const rows = await deps.queryRows<JobRow>(
        `UPDATE organization.device_ingress_rotation_job j
            SET state = 'sent', sent_at = now(), updated_at = now()
          WHERE j.id = $1 AND j.state = 'queued'
            AND EXISTS (
                SELECT 1 FROM organization.device_ingress_credential c
                 WHERE c.id = j.new_credential_id AND c.state = 'pending'
            )
          RETURNING ${JOB_COLUMNS_ALIASED}`,
        [input.id]
    );
    return rows[0] ? toJob(rows[0]) : null;
}

export function settleJobFinalized(
    input: {jobId: string; newCredentialId: string},
    deps: DeviceIngressTransactionDeps = defaultDeps
): Promise<RotationJob | null> {
    // The state-checked job update is the lock: a racing handshake finds no open
    // job, so the credential can never be activated twice or left half-settled.
    return deps.transaction(async (tx) => {
        const moved = await tx.queryRows<JobRow>(
            `UPDATE organization.device_ingress_rotation_job
                SET state = 'finalized', updated_at = now()
              WHERE id = $1 AND state IN ('sent', 'waiting')
              RETURNING ${JOB_COLUMNS}`,
            [input.jobId]
        );
        if (!moved[0]) return null;
        await activatePendingCredential(tx, {
            organizationId: moved[0].organization_id,
            credentialId: input.newCredentialId
        });
        return toJob(moved[0]);
    });
}

export async function settleJobRevokingKey(
    input: {
        jobId: string;
        newCredentialId: string | null;
        from: readonly RotationJobState[];
        to: RotationJobState;
        errorCode: RotationJobErrorCode;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob | null> {
    // Same lock as the finalize path: the unused new key dies with the job. A
    // null key matches no credential row, so the job still settles alone.
    const rows = await deps.queryRows<JobRow>(
        `WITH moved AS (
            UPDATE organization.device_ingress_rotation_job
                SET state = $3, error_code = $4, updated_at = now()
              WHERE id = $1 AND state = ANY($5::text[])
              RETURNING ${JOB_COLUMNS}
        ), revoked AS (
            UPDATE organization.device_ingress_credential
                SET state = 'revoked', updated_at = now()
              WHERE id = $2 AND state = 'pending'
                AND EXISTS (SELECT 1 FROM moved)
        )
        SELECT ${JOB_COLUMNS} FROM moved`,
        [
            input.jobId,
            input.newCredentialId,
            input.to,
            input.errorCode,
            input.from
        ]
    );
    return rows[0] ? toJob(rows[0]) : null;
}

export async function markStaleSentWaiting(
    input: {olderThanMs: number},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob[]> {
    const rows = await deps.queryRows<JobRow>(
        `UPDATE organization.device_ingress_rotation_job
            SET state = 'waiting', updated_at = now()
          WHERE state = 'sent' AND sent_at < now() - ($1 || ' ms')::interval
          RETURNING ${JOB_COLUMNS}`,
        [input.olderThanMs]
    );
    return rows.map(toJob);
}

export async function countJobsInState(
    state: RotationJobState,
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<number> {
    const rows = await deps.queryRows<{count: number}>(
        `SELECT COUNT(*)::int AS count
           FROM organization.device_ingress_rotation_job
          WHERE state = $1`,
        [state]
    );
    return rows[0]?.count ?? 0;
}

export async function findOpenJobByCredential(
    input: {credentialId: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<{job: RotationJob; side: 'new' | 'old'} | null> {
    const rows = await deps.queryRows<JobRow & {side: 'new' | 'old'}>(
        `SELECT ${JOB_COLUMNS},
                CASE WHEN new_credential_id = $1 THEN 'new' ELSE 'old' END AS side
           FROM organization.device_ingress_rotation_job
          WHERE state IN ('sent', 'waiting')
            AND (new_credential_id = $1 OR old_credential_id = $1)
          LIMIT 1`,
        [input.credentialId]
    );
    return rows[0] ? {job: toJob(rows[0]), side: rows[0].side} : null;
}

export async function getJob(
    input: {organizationId: string; id: string},
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<RotationJob | null> {
    const rows = await deps.queryRows<JobRow>(
        `SELECT ${JOB_COLUMNS_ALIASED}, i.expected_external_id
           FROM organization.device_ingress_rotation_job j
           ${IDENTITY_JOIN}
          WHERE j.organization_id = $1 AND j.id = $2
          LIMIT 1`,
        [input.organizationId, input.id]
    );
    return rows[0] ? toJob(rows[0]) : null;
}

export async function listJobs(
    input: {
        organizationId: string;
        batchId?: string;
        state?: RotationJobState;
        limit: number;
        offset: number;
    },
    deps: DeviceIngressRepositoryDeps = defaultDeps
): Promise<ListPage<RotationJob>> {
    const params: unknown[] = [input.organizationId];
    const clauses = ['j.organization_id = $1'];
    if (input.batchId) {
        params.push(input.batchId);
        clauses.push(`j.batch_id = $${params.length}`);
    }
    if (input.state) {
        params.push(input.state);
        clauses.push(`j.state = $${params.length}`);
    }
    params.push(input.limit, input.offset);
    const rows = await deps.queryRows<JobRow>(
        `SELECT ${JOB_COLUMNS_ALIASED}, i.expected_external_id,
                COUNT(*) OVER()::int AS total_count
           FROM organization.device_ingress_rotation_job j
           ${IDENTITY_JOIN}
          WHERE ${clauses.join(' AND ')}
          ORDER BY j.created_at DESC, j.id DESC
          LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
    );
    return {items: rows.map(toJob), total: totalFromRows(rows)};
}
