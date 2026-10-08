import type {JsonSchema} from '../../types/api/_schema.js';
import type {OperationJobSnapshot} from '../../types/api/job.js';
import {McpError} from './mcpErrors.js';
import type {
    OperationRecord,
    OperationRecoveryRegistration,
    OperationStore
} from './operationStore.js';
import type {OperateCaller} from './types.js';

const JOB_METHODS = {
    'backup.startdownloadjob': {
        adapter: 'backup_job',
        canonicalMethod: 'Backup.StartDownloadJob',
        kind: 'backup',
        mode: 'create'
    },
    'backup.startrestorejob': {
        adapter: 'backup_job',
        canonicalMethod: 'Backup.StartRestoreJob',
        kind: 'backup',
        mode: 'restore'
    },
    'firmware.startupdatejob': {
        adapter: 'firmware_job',
        canonicalMethod: 'Firmware.StartUpdateJob',
        kind: 'firmware',
        mode: 'channel'
    }
} as const;

type JobMethod = keyof typeof JOB_METHODS;
type JobKind = 'backup' | 'firmware';
type RecoveryState =
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'unknown';

function reconciliationScope(caller: OperateCaller) {
    if (!caller.organizationId || !caller.credentialId || !caller.userId) {
        throw new McpError(
            'permission_denied',
            'Operation reconciliation requires a tenant-bound credential and stable user identity'
        );
    }
    return {
        tenantId: caller.organizationId,
        principal: {
            userId: caller.userId,
            credentialId: caller.credentialId
        }
    };
}

interface JobRecoveryContext {
    type: 'job';
    method: string;
    params: Record<string, unknown>;
    domainIdempotencyKey: string;
    kind: JobKind;
    mode: string;
    deviceIds: string[];
    backupId?: string;
    backupName?: string;
    backupContents?: Record<string, boolean>;
    backupRestore?: Record<string, boolean>;
    firmwareChannel?: 'stable' | 'beta';
    firmwareAllowDowngrade?: boolean;
}

interface FileTransferRecoveryContext {
    type: 'file_transfer';
    method: 'fileTransfer.Finalize';
    params: {uploadId: string};
    uploadId: string;
}

type RecoveryContext = JobRecoveryContext | FileTransferRecoveryContext;

export interface OperationReconciliationReadEnvelope {
    method: string;
    result: unknown;
    truncated: boolean;
}

export type OperationReconciliationRead = (request: {
    method: string;
    params: Record<string, unknown>;
}) => Promise<OperationReconciliationReadEnvelope>;

export interface OperationRecoveryAction {
    action: 'resume' | 'cancel' | 'wait';
    method: string;
    params: Record<string, unknown>;
    reason: string;
}

export interface OperationReconciliationResult {
    operationId: string;
    method: string;
    receiptStatus: OperationRecord['status'];
    adapter: string | null;
    supported: boolean;
    state: RecoveryState;
    reason: string;
    target: {kind: string; id?: string};
    evidence: Record<string, unknown>;
    actions: OperationRecoveryAction[];
}

export const OPERATION_RECONCILIATION_INPUT_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['operationId'],
    additionalProperties: false,
    properties: {
        operationId: {type: 'string', format: 'uuid'}
    }
};

const RECOVERY_ACTION_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['action', 'method', 'params', 'reason'],
    additionalProperties: false,
    properties: {
        action: {type: 'string', enum: ['resume', 'cancel', 'wait']},
        method: {type: 'string'},
        params: {type: 'object', additionalProperties: true},
        reason: {type: 'string'}
    }
};

export const OPERATION_RECONCILIATION_OUTPUT_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'operationId',
        'method',
        'receiptStatus',
        'adapter',
        'supported',
        'state',
        'reason',
        'target',
        'evidence',
        'actions'
    ],
    additionalProperties: false,
    properties: {
        operationId: {type: 'string', format: 'uuid'},
        method: {type: 'string'},
        receiptStatus: {
            type: 'string',
            enum: [
                'reserved',
                'running',
                'succeeded',
                'failed',
                'outcome_unknown'
            ]
        },
        adapter: {type: ['string', 'null']},
        supported: {type: 'boolean'},
        state: {
            type: 'string',
            enum: ['running', 'completed', 'failed', 'cancelled', 'unknown']
        },
        reason: {type: 'string'},
        target: {
            type: 'object',
            required: ['kind'],
            additionalProperties: false,
            properties: {
                kind: {type: 'string'},
                id: {type: 'string'}
            }
        },
        evidence: {type: 'object', additionalProperties: true},
        actions: {type: 'array', items: RECOVERY_ACTION_SCHEMA}
    }
};

function strings(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;
    const items = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
    return items.length === value.length ? [...new Set(items)] : null;
}

function safeBooleanMap(value: unknown): Record<string, boolean> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const entries = Object.entries(value);
    if (entries.some(([, item]) => typeof item !== 'boolean')) return undefined;
    return Object.fromEntries(entries) as Record<string, boolean>;
}

function jobRecovery(
    normalizedMethod: JobMethod,
    params: Record<string, unknown>,
    operationId: string
): {
    registration: OperationRecoveryRegistration;
    effectiveParams: Record<string, unknown>;
} | null {
    const config = JOB_METHODS[normalizedMethod];
    const deviceIds = strings(
        normalizedMethod === 'backup.startrestorejob'
            ? [params.shellyID]
            : params.shellyIDs
    );
    if (!deviceIds) return null;
    const hasFirmwareUrl =
        typeof params.url === 'string' && params.url.length > 0;
    if (
        normalizedMethod === 'firmware.startupdatejob' &&
        (hasFirmwareUrl ||
            (params.channel !== 'stable' && params.channel !== 'beta'))
    ) {
        // URL payloads may contain signed credentials, so they are never stored.
        return null;
    }
    const suppliedKey = params.idempotencyKey;
    const domainIdempotencyKey =
        typeof suppliedKey === 'string' && suppliedKey.trim()
            ? suppliedKey
            : `mcp-${operationId}`;
    const backupContents = safeBooleanMap(params.contents);
    const backupRestore = safeBooleanMap(params.restore);
    const recoveryParams: Record<string, unknown> = {
        ...(normalizedMethod === 'backup.startdownloadjob'
            ? {
                  shellyIDs: params.shellyIDs,
                  ...(typeof params.name === 'string'
                      ? {name: params.name}
                      : {}),
                  ...(backupContents ? {contents: backupContents} : {})
              }
            : normalizedMethod === 'backup.startrestorejob'
              ? {
                    id: params.id,
                    shellyID: params.shellyID,
                    ...(backupRestore ? {restore: backupRestore} : {})
                }
              : {
                    shellyIDs: params.shellyIDs,
                    channel: params.channel,
                    ...(typeof params.targetBuildIdHint === 'string'
                        ? {targetBuildIdHint: params.targetBuildIdHint}
                        : {}),
                    ...(typeof params.allowDowngrade === 'boolean'
                        ? {allowDowngrade: params.allowDowngrade}
                        : {})
                }),
        idempotencyKey: domainIdempotencyKey
    };
    const effectiveParams: Record<string, unknown> = {
        ...params,
        idempotencyKey: domainIdempotencyKey
    };
    if (
        normalizedMethod === 'backup.startrestorejob' &&
        (typeof recoveryParams.id !== 'string' || !recoveryParams.id)
    ) {
        return null;
    }
    const context: JobRecoveryContext = {
        type: 'job',
        method: config.canonicalMethod,
        params: recoveryParams,
        domainIdempotencyKey,
        kind: config.kind,
        mode: config.mode,
        deviceIds,
        ...(normalizedMethod === 'backup.startrestorejob'
            ? {backupId: String(params.id)}
            : {}),
        ...(normalizedMethod === 'backup.startdownloadjob' &&
        typeof params.name === 'string'
            ? {backupName: params.name.trim()}
            : {}),
        ...(backupContents ? {backupContents} : {}),
        ...(backupRestore ? {backupRestore} : {}),
        ...(normalizedMethod === 'firmware.startupdatejob'
            ? {
                  firmwareChannel: params.channel as 'stable' | 'beta',
                  firmwareAllowDowngrade: params.allowDowngrade === true
              }
            : {})
    };
    return {
        registration: {adapter: config.adapter, context: {...context}},
        effectiveParams
    };
}

export function prepareOperationRecovery(input: {
    method: string;
    params: Record<string, unknown>;
    operationId: string;
}): {
    registration: OperationRecoveryRegistration;
    effectiveParams: Record<string, unknown>;
} | null {
    const normalizedMethod = input.method.trim().toLowerCase();
    if (normalizedMethod in JOB_METHODS) {
        return jobRecovery(
            normalizedMethod as JobMethod,
            input.params,
            input.operationId
        );
    }
    if (normalizedMethod === 'filetransfer.finalize') {
        if (
            typeof input.params.uploadId !== 'string' ||
            !input.params.uploadId
        ) {
            return null;
        }
        const params = {uploadId: input.params.uploadId};
        const context: FileTransferRecoveryContext = {
            type: 'file_transfer',
            method: 'fileTransfer.Finalize',
            params,
            uploadId: input.params.uploadId
        };
        return {
            registration: {
                adapter: 'file_transfer_finalize',
                context: {...context}
            },
            effectiveParams: params
        };
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
    value: Record<string, unknown>,
    allowed: readonly string[]
): boolean {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function validPersistedJobParams(value: Record<string, unknown>): boolean {
    if (
        typeof value.method !== 'string' ||
        typeof value.domainIdempotencyKey !== 'string' ||
        !isRecord(value.params) ||
        value.params.idempotencyKey !== value.domainIdempotencyKey
    ) {
        return false;
    }
    const params = value.params;
    const method = value.method.toLowerCase();
    if (method === 'backup.startdownloadjob') {
        return (
            hasOnlyKeys(params, [
                'shellyIDs',
                'name',
                'contents',
                'idempotencyKey'
            ]) && Boolean(strings(params.shellyIDs))
        );
    }
    if (method === 'backup.startrestorejob') {
        return (
            hasOnlyKeys(params, [
                'id',
                'shellyID',
                'restore',
                'idempotencyKey'
            ]) &&
            typeof params.id === 'string' &&
            typeof params.shellyID === 'string'
        );
    }
    if (method === 'firmware.startupdatejob') {
        return (
            hasOnlyKeys(params, [
                'shellyIDs',
                'channel',
                'targetBuildIdHint',
                'allowDowngrade',
                'idempotencyKey'
            ]) &&
            Boolean(strings(params.shellyIDs)) &&
            (params.channel === 'stable' || params.channel === 'beta')
        );
    }
    return false;
}

function persistedParamsMatchTarget(value: Record<string, unknown>): boolean {
    const params = value.params as Record<string, unknown>;
    const deviceIds = strings(value.deviceIds);
    if (!deviceIds) return false;
    const method = String(value.method).toLowerCase();
    if (method === 'backup.startrestorejob') {
        if (
            !sameStrings([params.shellyID], deviceIds) ||
            value.backupId !== params.id
        ) {
            return false;
        }
        const restore = safeBooleanMap(params.restore);
        return restore
            ? isRecord(value.backupRestore) &&
                  sameEnabledBooleans(value.backupRestore, restore)
            : value.backupRestore === undefined;
    }
    if (!sameStrings(params.shellyIDs, deviceIds)) return false;
    if (method === 'backup.startdownloadjob') {
        if (
            typeof params.name === 'string' &&
            value.backupName !== params.name.trim()
        ) {
            return false;
        }
        const contents = safeBooleanMap(params.contents);
        return contents
            ? isRecord(value.backupContents) &&
                  sameEnabledBooleans(value.backupContents, contents)
            : value.backupContents === undefined;
    }
    return (
        value.firmwareChannel === params.channel &&
        value.firmwareAllowDowngrade === (params.allowDowngrade === true)
    );
}

function parseContext(value: Record<string, unknown>): RecoveryContext | null {
    if (value.type === 'file_transfer') {
        const params = value.params;
        if (
            value.method === 'fileTransfer.Finalize' &&
            typeof value.uploadId === 'string' &&
            isRecord(params) &&
            params.uploadId === value.uploadId &&
            hasOnlyKeys(params, ['uploadId'])
        ) {
            return value as unknown as FileTransferRecoveryContext;
        }
        return null;
    }
    if (
        value.type !== 'job' ||
        typeof value.method !== 'string' ||
        typeof value.domainIdempotencyKey !== 'string' ||
        (value.kind !== 'backup' && value.kind !== 'firmware') ||
        typeof value.mode !== 'string' ||
        !strings(value.deviceIds) ||
        !isRecord(value.params) ||
        !validPersistedJobParams(value) ||
        !persistedParamsMatchTarget(value)
    ) {
        return null;
    }
    return value as unknown as JobRecoveryContext;
}

function contextMatchesOperation(
    context: RecoveryContext,
    operation: OperationRecord,
    adapter: string
): boolean {
    if (context.method.toLowerCase() !== operation.method.toLowerCase()) {
        return false;
    }
    if (context.type === 'file_transfer') {
        return adapter === 'file_transfer_finalize';
    }
    const config = JOB_METHODS[context.method.toLowerCase() as JobMethod];
    return Boolean(
        config &&
            config.adapter === adapter &&
            config.kind === context.kind &&
            config.mode === context.mode
    );
}

function baseResult(
    operation: OperationRecord,
    adapter: string | null,
    supported: boolean,
    state: RecoveryState,
    reason: string,
    target: {kind: string; id?: string},
    evidence: Record<string, unknown>,
    actions: OperationRecoveryAction[] = []
): OperationReconciliationResult {
    return {
        operationId: operation.id,
        method: operation.method,
        receiptStatus: operation.status,
        adapter,
        supported,
        state,
        reason,
        target,
        evidence,
        actions
    };
}

function sameStrings(left: unknown, right: readonly string[]): boolean {
    const actual = strings(left);
    if (!actual || actual.length !== right.length) return false;
    const a = [...actual].sort();
    const b = [...right].sort();
    return a.every((item, index) => item === b[index]);
}

function enabledBooleanKeys(value: unknown): string[] | null {
    if (!isRecord(value)) return null;
    const entries = Object.entries(value);
    if (entries.some(([, item]) => typeof item !== 'boolean')) return null;
    return entries
        .filter(([, item]) => item === true)
        .map(([key]) => key)
        .sort();
}

function sameEnabledBooleans(
    actual: unknown,
    expected: Record<string, boolean>
): boolean {
    const actualKeys = enabledBooleanKeys(actual);
    const expectedKeys = enabledBooleanKeys(expected);
    return Boolean(
        actualKeys &&
            expectedKeys &&
            actualKeys.length === expectedKeys.length &&
            actualKeys.every((key, index) => key === expectedKeys[index])
    );
}

function jobBindingMatches(
    job: OperationJobSnapshot,
    context: JobRecoveryContext
): boolean {
    if (job.kind !== context.kind) return false;
    const metadata = job.metadata;
    const target = isRecord(metadata.targetSummary)
        ? metadata.targetSummary
        : null;
    if (metadata.mode !== context.mode || !target) return false;
    if (!sameStrings(target.deviceIds, context.deviceIds)) return false;
    if (
        context.backupId !== undefined &&
        target.backupId !== context.backupId
    ) {
        return false;
    }
    if (context.kind === 'backup' && target.name !== context.backupName) {
        return false;
    }
    if (
        context.kind === 'backup' &&
        (context.backupContents === undefined
            ? target.contents !== undefined
            : !sameEnabledBooleans(target.contents, context.backupContents))
    ) {
        return false;
    }
    if (
        context.kind === 'backup' &&
        (context.backupRestore === undefined
            ? target.restore !== undefined
            : !sameEnabledBooleans(target.restore ?? {}, context.backupRestore))
    ) {
        return false;
    }
    if (context.firmwareChannel !== undefined) {
        const request = isRecord(target.request) ? target.request : null;
        if (
            request?.type !== 'channel' ||
            request.value !== context.firmwareChannel ||
            request.allowDowngrade !== context.firmwareAllowDowngrade
        ) {
            return false;
        }
    }
    return true;
}

function readResult(
    envelope: OperationReconciliationReadEnvelope,
    expectedMethod: string
): unknown {
    if (envelope.method.toLowerCase() !== expectedMethod.toLowerCase()) {
        throw new McpError(
            'operation_unavailable',
            'Authoritative reconciliation evidence came from the wrong method'
        );
    }
    if (envelope.truncated) {
        throw new McpError(
            'operation_unavailable',
            'Authoritative reconciliation evidence was truncated'
        );
    }
    return envelope.result;
}

async function reconcileJob(input: {
    operation: OperationRecord;
    adapter: string;
    context: JobRecoveryContext;
    domainJobId: string | null;
    scope: ReturnType<typeof reconciliationScope> & {operationId: string};
    store: OperationStore;
    read: OperationReconciliationRead;
}): Promise<OperationReconciliationResult> {
    const jobId =
        input.domainJobId ?? (await input.store.findRecoveryJob?.(input.scope));
    if (!jobId) {
        const canResume = ['reserved', 'failed', 'outcome_unknown'].includes(
            input.operation.status
        );
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'unknown',
            'No domain job exists for the persisted idempotency key.',
            {kind: input.context.kind},
            {jobFound: false, bindingChecked: true},
            canResume
                ? [
                      {
                          action: 'resume',
                          method: input.context.method,
                          params: input.context.params,
                          reason: 'The tenant job store has no matching job; governed execution with the same domain key cannot create a duplicate.'
                      }
                  ]
                : []
        );
    }
    const raw = readResult(
        await input.read({
            method: 'Job.Get',
            params: {jobId, kind: input.context.kind}
        }),
        'Job.Get'
    );
    if (!isRecord(raw)) {
        throw new McpError(
            'operation_unavailable',
            'Job.Get returned invalid reconciliation evidence'
        );
    }
    const job = raw as unknown as OperationJobSnapshot;
    if (!jobBindingMatches(job, input.context)) {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'unknown',
            'The discovered job does not match the persisted recovery target.',
            {kind: input.context.kind, id: jobId},
            {jobFound: true, bindingChecked: false}
        );
    }
    const evidence = {
        jobFound: true,
        bindingChecked: true,
        jobStatus: job.status,
        total: job.total,
        doneCount: job.doneCount,
        failCount: job.failCount,
        startedAt: job.startedAt,
        endedAt: job.endedAt
    };
    const control = job.control;
    if (control) {
        const capabilities = readResult(
            await input.read({
                method: 'Job.Capabilities',
                params: {jobId, kind: input.context.kind}
            }),
            'Job.Capabilities'
        );
        if (!isRecord(capabilities)) {
            throw new McpError(
                'operation_unavailable',
                'Invalid job control capabilities'
            );
        }
        const actions: OperationRecoveryAction[] = [];
        if (
            isRecord(capabilities.cancel) &&
            capabilities.cancel.supported === true
        ) {
            actions.push({
                action: 'cancel',
                method: 'Job.Cancel',
                params: {jobId, kind: input.context.kind},
                reason: 'Request cancellation of remaining undispatched work; already dispatched effects may continue.'
            });
        }
        if (
            isRecord(capabilities.resume) &&
            capabilities.resume.supported === true
        ) {
            actions.push({
                action: 'resume',
                method: 'Job.Resume',
                params: {jobId, kind: input.context.kind},
                reason: 'Resume only units known to have stopped before dispatch, with current authorization.'
            });
        }
        const inFlight =
            control.queuedCount +
                control.claimedCount +
                control.dispatchedCount >
            0;
        if (inFlight)
            actions.push({
                action: 'wait',
                method: 'Job.Get',
                params: {jobId, kind: input.context.kind},
                reason: 'Observe the authoritative job outcome.'
            });
        const state: RecoveryState =
            control.unresolvedCount > 0
                ? 'unknown'
                : inFlight
                  ? 'running'
                  : control.stoppedCount > 0
                    ? 'cancelled'
                    : job.status === 'done'
                      ? 'completed'
                      : job.status === 'failed'
                        ? 'failed'
                        : 'unknown';
        return baseResult(
            input.operation,
            input.adapter,
            true,
            state,
            'Job control reports observed outcomes; cancellation does not undo completed or dispatched effects.',
            {kind: input.context.kind, id: jobId},
            {...evidence, control},
            actions
        );
    }
    if (job.status === 'done') {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'completed',
            'The authoritative domain job is complete.',
            {kind: input.context.kind, id: jobId},
            evidence
        );
    }
    if (job.status === 'failed') {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'failed',
            'The authoritative domain job failed.',
            {kind: input.context.kind, id: jobId},
            evidence
        );
    }
    if (job.total === 0) {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'unknown',
            'The domain job exists without queued units; replay cannot safely repair partial dispatch.',
            {kind: input.context.kind, id: jobId},
            evidence
        );
    }
    return baseResult(
        input.operation,
        input.adapter,
        true,
        'running',
        'The authoritative domain job is queued or running.',
        {kind: input.context.kind, id: jobId},
        evidence,
        [
            {
                action: 'wait',
                method: 'Job.Get',
                params: {jobId, kind: input.context.kind},
                reason: 'Poll the same tenant-scoped job for a terminal state.'
            }
        ]
    );
}

async function reconcileFileTransfer(input: {
    operation: OperationRecord;
    adapter: string;
    context: FileTransferRecoveryContext;
    read: OperationReconciliationRead;
}): Promise<OperationReconciliationResult> {
    const raw = readResult(
        await input.read({
            method: 'fileTransfer.Get',
            params: input.context.params
        }),
        'fileTransfer.Get'
    );
    if (!isRecord(raw) || raw.uploadId !== input.context.uploadId) {
        throw new McpError(
            'operation_unavailable',
            'fileTransfer.Get returned invalid reconciliation evidence'
        );
    }
    const status = raw.status;
    const evidence = {
        status,
        nextOffset: raw.nextOffset,
        sizeBytes: raw.sizeBytes,
        sha256: raw.sha256,
        ...(status === 'finalized' && isRecord(raw.result)
            ? {artifact: raw.result}
            : {})
    };
    if (status === 'finalized') {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'completed',
            'The upload is finalized and its artifact result is authoritative.',
            {kind: 'file_transfer', id: input.context.uploadId},
            evidence
        );
    }
    if (status === 'cancelled') {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'cancelled',
            'The upload is authoritatively cancelled.',
            {kind: 'file_transfer', id: input.context.uploadId},
            evidence
        );
    }
    if (status !== 'open') {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'unknown',
            'The upload is finalizing or already has an unknown outcome; retry and cancellation are unsafe.',
            {kind: 'file_transfer', id: input.context.uploadId},
            evidence
        );
    }
    if (input.operation.status === 'running') {
        return baseResult(
            input.operation,
            input.adapter,
            true,
            'running',
            'The receipt executor is still active; no competing action is safe.',
            {kind: 'file_transfer', id: input.context.uploadId},
            evidence
        );
    }
    return baseResult(
        input.operation,
        input.adapter,
        true,
        'unknown',
        'The upload remains open and the original receipt is inactive.',
        {kind: 'file_transfer', id: input.context.uploadId},
        evidence,
        [
            {
                action: 'resume',
                method: 'fileTransfer.Finalize',
                params: input.context.params,
                reason: 'Finalize rechecks the owner, upload completeness, checksum, and atomic finalization claim.'
            },
            {
                action: 'cancel',
                method: 'fileTransfer.Cancel',
                params: input.context.params,
                reason: 'Cancel rechecks the owner and refuses a claimed or non-open upload.'
            }
        ]
    );
}

export function createOperationReconciliation(deps: {
    store: OperationStore;
    read: OperationReconciliationRead;
}) {
    return async function reconcile(input: {
        caller: OperateCaller;
        operationId: string;
    }): Promise<OperationReconciliationResult> {
        const scope = {
            ...reconciliationScope(input.caller),
            operationId: input.operationId
        };
        const operation = await deps.store.get(scope);
        if (!operation) {
            throw new McpError(
                'operation_unavailable',
                'Operation receipt is unavailable'
            );
        }
        if (!deps.store.getRecovery) {
            return baseResult(
                operation,
                null,
                false,
                'unknown',
                'Recovery metadata storage is unavailable.',
                {kind: 'operation'},
                {registered: false}
            );
        }
        const recovery = await deps.store.getRecovery(scope);
        if (!recovery) {
            return baseResult(
                operation,
                null,
                false,
                'unknown',
                'This operation has no target-aware recovery adapter.',
                {kind: 'operation'},
                {registered: false}
            );
        }
        const context = parseContext(recovery.context);
        if (
            !context ||
            !contextMatchesOperation(context, operation, recovery.adapter)
        ) {
            return baseResult(
                operation,
                recovery.adapter,
                false,
                'unknown',
                'Persisted recovery metadata is invalid.',
                {kind: 'operation'},
                {registered: true, valid: false}
            );
        }
        if (context.type === 'file_transfer') {
            return reconcileFileTransfer({
                operation,
                adapter: recovery.adapter,
                context,
                read: deps.read
            });
        }
        if (!recovery.domainJobId && !deps.store.findRecoveryJob) {
            return baseResult(
                operation,
                recovery.adapter,
                false,
                'unknown',
                'Domain job lookup is unavailable.',
                {kind: context.kind},
                {registered: true}
            );
        }
        return reconcileJob({
            operation,
            adapter: recovery.adapter,
            context,
            domainJobId: recovery.domainJobId,
            scope,
            store: deps.store,
            read: deps.read
        });
    };
}
