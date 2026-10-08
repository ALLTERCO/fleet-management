import {McpError} from './mcpErrors.js';
import {prepareOperationRecovery} from './operationReconciliation.js';
import type {OperationRecord, OperationStore} from './operationStore.js';
import type {OperateCaller} from './types.js';

export function operationScope(caller: OperateCaller) {
    if (!caller.organizationId || !caller.credentialId || !caller.userId) {
        throw new McpError(
            'permission_denied',
            'Durable operations require a tenant-bound credential and stable user identity'
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

export function operationEnvelope(operation: OperationRecord) {
    return {
        operationId: operation.id,
        method: operation.method,
        status: operation.status,
        result: operation.result,
        resultTruncated: operation.resultTruncated,
        errorCode: operation.errorCode,
        outcomeSummary: operation.outcomeSummary,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        expiresAt: operation.expiresAt
    };
}

export async function executeDurableOperation(input: {
    store: OperationStore;
    caller: OperateCaller;
    method: string;
    params: Record<string, unknown>;
    idempotencyKey: string;
    beforeExecute?: () => Promise<void>;
    execute: (executionParams: Record<string, unknown>) => Promise<unknown>;
}) {
    const scope = operationScope(input.caller);
    const reserved = await input.store.reserve({
        ...scope,
        method: input.method,
        params: input.params,
        idempotencyKey: input.idempotencyKey
    });
    if (!reserved.bindingMatched || !reserved.operation) {
        throw new McpError(
            'invalid_params',
            'Idempotency key is already bound to a different operation'
        );
    }
    if (reserved.operation.status !== 'reserved')
        return operationEnvelope(reserved.operation);
    const identity = {...scope, operationId: reserved.operation.id};
    let executionParams = input.params;
    const recovery = prepareOperationRecovery({
        method: input.method,
        params: input.params,
        operationId: reserved.operation.id
    });
    if (recovery) {
        if (!input.store.registerRecovery) {
            throw new McpError(
                'operation_unavailable',
                'Target-aware recovery storage is unavailable'
            );
        }
        const registered = await input.store.registerRecovery({
            ...identity,
            recovery: recovery.registration
        });
        if (!registered) {
            throw new McpError(
                'operation_unavailable',
                'Target-aware recovery could not be registered'
            );
        }
        executionParams = recovery.effectiveParams;
    }
    const running = await input.store.start(identity);
    if (!running) {
        const existing = await input.store.get(identity);
        if (existing) return operationEnvelope(existing);
        throw new McpError(
            'operation_unavailable',
            'Operation could not be started'
        );
    }

    // A dropped HTTP connection must not discard the eventual outcome.
    void (async () => {
        try {
            await input.beforeExecute?.();
        } catch {
            await input.store.recordDefinitiveFailure({
                ...identity,
                errorCode: 'audit_unavailable',
                summary:
                    'Pre-execution audit failed; the mutation was not started.'
            });
            return;
        }
        try {
            if (!(await input.store.canExecute(identity))) {
                await input.store.recordOutcomeUnknown({
                    ...identity,
                    summary:
                        'Execution lease was lost before dispatch; the mutation was not started.'
                });
                return;
            }
            const result = await input.execute(executionParams);
            if (
                recovery &&
                recovery.registration.adapter !== 'file_transfer_finalize' &&
                result &&
                typeof result === 'object' &&
                typeof (result as {jobId?: unknown}).jobId === 'string'
            ) {
                if (!input.store.linkRecoveryJob) {
                    throw new Error('recovery job linkage is unavailable');
                }
                const linked = await input.store.linkRecoveryJob({
                    ...identity,
                    jobId: (result as {jobId: string}).jobId
                });
                if (!linked) throw new Error('recovery job linkage failed');
            }
            const settled = await input.store.recordSuccess({
                ...identity,
                result
            });
            if (!settled) throw new Error('outcome persistence failed');
        } catch {
            // An RPC error can follow a partial external side effect.
            await input.store.recordOutcomeUnknown({
                ...identity,
                summary:
                    'Execution or outcome persistence failed; inspect the target before retrying with a new key.'
            });
        }
    })()
        .finally(() => input.store.finishExecution(identity))
        .catch(() => {
            // Lease expiry exposes outcomes that could not be persisted.
        });
    return operationEnvelope(running);
}
