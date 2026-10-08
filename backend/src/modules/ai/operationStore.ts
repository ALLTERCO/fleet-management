import {createHash, randomUUID} from 'node:crypto';
import {stableJson} from '../authz/stableJson.js';
import {asJsonbParam, callMethod as callDbMethod} from '../PostgresProvider.js';
import {sanitizeErrorMessageForPersistence} from '../util/sanitizeErrorMessage.js';
import {buildReadEnvelope} from './readEnvelope.js';

export const MCP_OPERATION_RETENTION_SECONDS = 24 * 60 * 60;
export const MCP_OPERATION_LEASE_SECONDS = 90;
export const MCP_OPERATION_MAINTENANCE_BATCH_SIZE = 200;

const MAX_TENANT_LENGTH = 120;
const MAX_USER_ID_LENGTH = 255;
const MAX_CREDENTIAL_ID_LENGTH = 4096;
const MAX_IDEMPOTENCY_KEY_LENGTH = 4096;
const MAX_METHOD_LENGTH = 250;
const MAX_ERROR_CODE_LENGTH = 100;
const MAX_OUTCOME_SUMMARY_LENGTH = 1000;
const MAX_RECOVERY_CONTEXT_BYTES = 32 * 1024;

export type OperationStatus =
    | 'reserved'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'outcome_unknown';

export interface OperationPrincipal {
    userId: string;
    credentialId: string;
}

export interface OperationRecord {
    id: string;
    tenantId: string;
    principalUserId: string;
    method: string;
    status: OperationStatus;
    result: unknown | null;
    resultTruncated: boolean;
    errorCode: string | null;
    outcomeSummary: string | null;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    updatedAt: string;
    expiresAt: string;
}

export interface ReserveOperationInput {
    tenantId: string;
    principal: OperationPrincipal;
    method: string;
    params: Record<string, unknown>;
    idempotencyKey: string;
}

export interface ScopedOperationInput {
    tenantId: string;
    principal: OperationPrincipal;
    operationId: string;
}

export interface ReserveOperationResult {
    created: boolean;
    bindingMatched: boolean;
    operation?: OperationRecord;
}

export type OperationRecoveryAdapter =
    | 'backup_job'
    | 'firmware_job'
    | 'file_transfer_finalize';

export interface OperationRecoveryRegistration {
    adapter: OperationRecoveryAdapter;
    context: Record<string, unknown>;
}

export interface OperationRecoveryRecord {
    operation: OperationRecord;
    adapter: OperationRecoveryAdapter;
    context: Record<string, unknown>;
    domainJobId: string | null;
}

export interface RecordOperationSuccessInput extends ScopedOperationInput {
    result: unknown;
}

export interface RecordDefinitiveOperationFailureInput
    extends ScopedOperationInput {
    errorCode: string;
    summary: string;
}

export interface RecordOperationOutcomeUnknownInput
    extends ScopedOperationInput {
    summary: string;
}

export interface RegisterOperationRecoveryInput extends ScopedOperationInput {
    recovery: OperationRecoveryRegistration;
}

export interface LinkOperationRecoveryJobInput extends ScopedOperationInput {
    jobId: string;
}

interface DbResult {
    rows?: ReadonlyArray<Record<string, unknown>>;
}

export interface OperationStoreDeps {
    callMethod(
        method: string,
        params: Record<string, unknown>
    ): Promise<unknown>;
    newId(): string;
    executorId?: string;
}

interface OperationDbRow {
    id: string;
    organization_id: string;
    principal_user_id: string;
    method: string;
    status: OperationStatus;
    result: unknown | null;
    result_truncated: boolean;
    error_code: string | null;
    outcome_summary: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    updated_at: string;
    expires_at: string;
}

interface ReserveDbRow extends Record<string, unknown> {
    operation: OperationDbRow | null;
    created: boolean;
    binding_matched: boolean;
}

interface OperationResultDbRow extends Record<string, unknown> {
    operation: OperationDbRow;
}

interface CanExecuteDbRow extends Record<string, unknown> {
    can_execute: boolean;
}

interface MaintenanceDbRow extends Record<string, unknown> {
    leases_renewed: number;
    orphaned: number;
    purged: number;
}

interface ReleaseDbRow extends Record<string, unknown> {
    released: number;
}

interface OperationRecoveryDbRow extends Record<string, unknown> {
    operation: OperationDbRow;
    recovery_adapter: OperationRecoveryAdapter;
    recovery_context: Record<string, unknown>;
    domain_job_id: string | null;
}

interface RecoveryJobDbRow extends Record<string, unknown> {
    job_id: string | null;
}

export interface OperationMaintenanceResult {
    leasesRenewed: number;
    orphaned: number;
    purged: number;
    moreActive: boolean;
}

export interface OperationLifecycleStore {
    maintain(): Promise<OperationMaintenanceResult>;
    release(): Promise<number>;
}

export interface OperationStore {
    reserve(input: ReserveOperationInput): Promise<ReserveOperationResult>;
    get(input: ScopedOperationInput): Promise<OperationRecord | null>;
    start(input: ScopedOperationInput): Promise<OperationRecord | null>;
    canExecute(input: ScopedOperationInput): Promise<boolean>;
    finishExecution(input: ScopedOperationInput): void;
    registerRecovery?(
        input: RegisterOperationRecoveryInput
    ): Promise<OperationRecoveryRecord | null>;
    getRecovery?(
        input: ScopedOperationInput
    ): Promise<OperationRecoveryRecord | null>;
    linkRecoveryJob?(
        input: LinkOperationRecoveryJobInput
    ): Promise<OperationRecoveryRecord | null>;
    findRecoveryJob?(input: ScopedOperationInput): Promise<string | null>;
    recordSuccess(
        input: RecordOperationSuccessInput
    ): Promise<OperationRecord | null>;
    recordDefinitiveFailure(
        input: RecordDefinitiveOperationFailureInput
    ): Promise<OperationRecord | null>;
    recordOutcomeUnknown(
        input: RecordOperationOutcomeUnknownInput
    ): Promise<OperationRecord | null>;
}

function requiredText(value: string, name: string, maxLength: number): string {
    const trimmed = value.trim();
    if (!trimmed) throw new Error(`${name} is required`);
    if (trimmed.length > maxLength) {
        throw new Error(`${name} exceeds ${maxLength} characters`);
    }
    return trimmed;
}

function normalizedMethod(method: string): string {
    return requiredText(method, 'method', MAX_METHOD_LENGTH).toLowerCase();
}

function sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}

function credentialHash(principal: OperationPrincipal): string {
    return sha256(
        requiredText(
            principal.credentialId,
            'principal.credentialId',
            MAX_CREDENTIAL_ID_LENGTH
        )
    );
}

function scopeParams(input: ScopedOperationInput): Record<string, unknown> {
    return {
        p_id: requiredText(input.operationId, 'operationId', 64),
        p_organization_id: requiredText(
            input.tenantId,
            'tenantId',
            MAX_TENANT_LENGTH
        ),
        p_principal_user_id: requiredText(
            input.principal.userId,
            'principal.userId',
            MAX_USER_ID_LENGTH
        ),
        p_credential_identity_hash: credentialHash(input.principal)
    };
}

function firstRow<T extends Record<string, unknown>>(
    result: unknown
): T | undefined {
    return (result as DbResult | undefined)?.rows?.[0] as T | undefined;
}

function operationFromResult(result: unknown): OperationRecord | null {
    const row = firstRow<OperationResultDbRow>(result);
    return row?.operation ? mapOperation(row.operation) : null;
}

function mapOperation(row: OperationDbRow): OperationRecord {
    return {
        id: row.id,
        tenantId: row.organization_id,
        principalUserId: row.principal_user_id,
        method: row.method,
        status: row.status,
        result: row.result,
        resultTruncated: row.result_truncated,
        errorCode: row.error_code,
        outcomeSummary: row.outcome_summary,
        createdAt: row.created_at,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        updatedAt: row.updated_at,
        expiresAt: row.expires_at
    };
}

function safePersistedMessage(raw: string, name: string): string {
    const maxLength =
        name === 'errorCode'
            ? MAX_ERROR_CODE_LENGTH
            : MAX_OUTCOME_SUMMARY_LENGTH;
    const required = requiredText(raw, name, 16_384);
    return (
        sanitizeErrorMessageForPersistence(required, maxLength) ??
        'details unavailable'
    );
}

function recoveryFromResult(result: unknown): OperationRecoveryRecord | null {
    const row = firstRow<OperationRecoveryDbRow>(result);
    if (!row?.operation) return null;
    return {
        operation: mapOperation(row.operation),
        adapter: row.recovery_adapter,
        context: row.recovery_context,
        domainJobId: row.domain_job_id
    };
}

function recoveryParams(
    recovery: OperationRecoveryRegistration
): Record<string, unknown> {
    const context = stableJson(recovery.context);
    if (Buffer.byteLength(context, 'utf8') > MAX_RECOVERY_CONTEXT_BYTES) {
        throw new Error('operation recovery context exceeds 32768 bytes');
    }
    return {
        p_recovery_adapter: recovery.adapter,
        p_recovery_context: asJsonbParam(recovery.context)
    };
}

export function createOperationStore(
    deps: OperationStoreDeps
): OperationStore & OperationLifecycleStore {
    const executorId = requiredText(
        deps.executorId ?? randomUUID(),
        'executorId',
        36
    );
    const activeOperationIds = new Set<string>();
    let maintenanceSnapshot: string[] | null = null;
    let maintenanceCursor = 0;

    async function get(
        input: ScopedOperationInput
    ): Promise<OperationRecord | null> {
        const result = await deps.callMethod(
            'fm.fn_mcp_operation_get',
            scopeParams(input)
        );
        return operationFromResult(result);
    }

    async function reserve(
        input: ReserveOperationInput
    ): Promise<ReserveOperationResult> {
        const tenantId = requiredText(
            input.tenantId,
            'tenantId',
            MAX_TENANT_LENGTH
        );
        const userId = requiredText(
            input.principal.userId,
            'principal.userId',
            MAX_USER_ID_LENGTH
        );
        const idempotencyKey = requiredText(
            input.idempotencyKey,
            'idempotencyKey',
            MAX_IDEMPOTENCY_KEY_LENGTH
        );
        const method = normalizedMethod(input.method);
        const result = await deps.callMethod('fm.fn_mcp_operation_reserve', {
            p_id: deps.newId(),
            p_organization_id: tenantId,
            p_principal_user_id: userId,
            p_credential_identity_hash: credentialHash(input.principal),
            p_idempotency_key_hash: sha256(idempotencyKey),
            p_method: method,
            p_params_hash: sha256(stableJson(input.params)),
            p_retention_seconds: MCP_OPERATION_RETENTION_SECONDS
        });
        const row = firstRow<ReserveDbRow>(result);
        if (!row) {
            throw new Error('MCP operation reservation returned no row');
        }
        return {
            created: row.created,
            bindingMatched: row.binding_matched,
            ...(row.operation ? {operation: mapOperation(row.operation)} : {})
        };
    }

    async function start(
        input: ScopedOperationInput
    ): Promise<OperationRecord | null> {
        const result = await deps.callMethod('fm.fn_mcp_operation_claim', {
            ...scopeParams(input),
            p_executor_id: executorId,
            p_lease_seconds: MCP_OPERATION_LEASE_SECONDS
        });
        const operation = operationFromResult(result);
        if (operation) activeOperationIds.add(operation.id);
        return operation;
    }

    async function canExecute(input: ScopedOperationInput): Promise<boolean> {
        const result = await deps.callMethod(
            'fm.fn_mcp_operation_can_execute',
            {
                ...scopeParams(input),
                p_executor_id: executorId
            }
        );
        return firstRow<CanExecuteDbRow>(result)?.can_execute === true;
    }

    async function registerRecovery(
        input: RegisterOperationRecoveryInput
    ): Promise<OperationRecoveryRecord | null> {
        const result = await deps.callMethod(
            'fm.fn_mcp_operation_register_recovery',
            {
                ...scopeParams(input),
                ...recoveryParams(input.recovery)
            }
        );
        return recoveryFromResult(result);
    }

    async function getRecovery(
        input: ScopedOperationInput
    ): Promise<OperationRecoveryRecord | null> {
        const result = await deps.callMethod(
            'fm.fn_mcp_operation_recovery_get',
            scopeParams(input)
        );
        return recoveryFromResult(result);
    }

    async function linkRecoveryJob(
        input: LinkOperationRecoveryJobInput
    ): Promise<OperationRecoveryRecord | null> {
        const result = await deps.callMethod(
            'fm.fn_mcp_operation_link_recovery_job',
            {
                ...scopeParams(input),
                p_executor_id: executorId,
                p_job_id: requiredText(input.jobId, 'jobId', 64)
            }
        );
        return recoveryFromResult(result);
    }

    async function findRecoveryJob(
        input: ScopedOperationInput
    ): Promise<string | null> {
        const result = await deps.callMethod(
            'fm.fn_mcp_operation_find_recovery_job',
            scopeParams(input)
        );
        return firstRow<RecoveryJobDbRow>(result)?.job_id ?? null;
    }

    function finishExecution(input: ScopedOperationInput): void {
        activeOperationIds.delete(input.operationId);
    }

    async function recordSuccess(
        input: RecordOperationSuccessInput
    ): Promise<OperationRecord | null> {
        try {
            const operation = await get(input);
            const canSettleLate =
                operation?.status === 'outcome_unknown' &&
                operation.errorCode === 'executor_lost';
            if (operation?.status !== 'running' && !canSettleLate) return null;
            const envelope = buildReadEnvelope(
                operation.method,
                input.result ?? null
            );
            const result = await deps.callMethod(
                'fm.fn_mcp_operation_settle_success',
                {
                    ...scopeParams(input),
                    p_executor_id: executorId,
                    p_result: asJsonbParam(envelope.result),
                    p_result_truncated: envelope.truncated
                }
            );
            return operationFromResult(result);
        } finally {
            finishExecution(input);
        }
    }

    async function recordDefinitiveFailure(
        input: RecordDefinitiveOperationFailureInput
    ): Promise<OperationRecord | null> {
        try {
            const result = await deps.callMethod(
                'fm.fn_mcp_operation_settle_failure',
                {
                    ...scopeParams(input),
                    p_executor_id: executorId,
                    p_error_code: safePersistedMessage(
                        input.errorCode,
                        'errorCode'
                    ),
                    p_outcome_summary: safePersistedMessage(
                        input.summary,
                        'summary'
                    )
                }
            );
            return operationFromResult(result);
        } finally {
            finishExecution(input);
        }
    }

    async function recordOutcomeUnknown(
        input: RecordOperationOutcomeUnknownInput
    ): Promise<OperationRecord | null> {
        try {
            const result = await deps.callMethod(
                'fm.fn_mcp_operation_settle_unknown',
                {
                    ...scopeParams(input),
                    p_executor_id: executorId,
                    p_outcome_summary: safePersistedMessage(
                        input.summary,
                        'summary'
                    )
                }
            );
            return operationFromResult(result);
        } finally {
            finishExecution(input);
        }
    }

    async function maintain(): Promise<OperationMaintenanceResult> {
        if (!maintenanceSnapshot) {
            maintenanceSnapshot = Array.from(activeOperationIds);
            maintenanceCursor = 0;
        }
        const nextCursor = Math.min(
            maintenanceCursor + MCP_OPERATION_MAINTENANCE_BATCH_SIZE,
            maintenanceSnapshot.length
        );
        const activeIds = maintenanceSnapshot
            .slice(maintenanceCursor, nextCursor)
            .filter((operationId) => activeOperationIds.has(operationId));
        const moreActive = nextCursor < maintenanceSnapshot.length;
        const result = await deps.callMethod('fm.fn_mcp_operation_maintain', {
            p_executor_id: executorId,
            p_active_operation_ids: activeIds,
            p_recover_owned: !moreActive,
            p_lease_seconds: MCP_OPERATION_LEASE_SECONDS,
            p_batch_size: MCP_OPERATION_MAINTENANCE_BATCH_SIZE
        });
        const row = firstRow<MaintenanceDbRow>(result);
        if (!row) throw new Error('MCP operation maintenance returned no row');
        maintenanceCursor = nextCursor;
        if (!moreActive) {
            maintenanceSnapshot = null;
            maintenanceCursor = 0;
        }
        return {
            leasesRenewed: Number(row.leases_renewed),
            orphaned: Number(row.orphaned),
            purged: Number(row.purged),
            moreActive
        };
    }

    async function release(): Promise<number> {
        const result = await deps.callMethod('fm.fn_mcp_operation_release', {
            p_executor_id: executorId,
            p_batch_size: MCP_OPERATION_MAINTENANCE_BATCH_SIZE
        });
        const row = firstRow<ReleaseDbRow>(result);
        if (!row) throw new Error('MCP operation release returned no row');
        return Number(row.released);
    }

    return {
        reserve,
        get,
        start,
        canExecute,
        finishExecution,
        registerRecovery,
        getRecovery,
        linkRecoveryJob,
        findRecoveryJob,
        recordSuccess,
        recordDefinitiveFailure,
        recordOutcomeUnknown,
        maintain,
        release
    };
}

const defaultStore = createOperationStore({
    callMethod: callDbMethod,
    newId: randomUUID
});

export const reserveOperation = defaultStore.reserve;
export const getOperation = defaultStore.get;
export const startOperation = defaultStore.start;
export const canExecuteOperation = defaultStore.canExecute;
export const finishOperationExecution = defaultStore.finishExecution;
export const registerOperationRecovery = defaultStore.registerRecovery;
export const getOperationRecovery = defaultStore.getRecovery;
export const linkOperationRecoveryJob = defaultStore.linkRecoveryJob;
export const findOperationRecoveryJob = defaultStore.findRecoveryJob;
export const recordOperationSuccess = defaultStore.recordSuccess;
export const recordDefinitiveOperationFailure =
    defaultStore.recordDefinitiveFailure;
export const recordOperationOutcomeUnknown = defaultStore.recordOutcomeUnknown;
export const maintainOperationLeases = defaultStore.maintain;
export const releaseOperationLeases = defaultStore.release;
