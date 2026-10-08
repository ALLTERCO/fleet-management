import {createHash, randomBytes} from 'node:crypto';
import log4js from 'log4js';
import type CommandSender from '../../model/CommandSender';
import {canAuthorDeviceScopedAutomation} from '../../model/component/authzPermissions';
import RpcError from '../../rpc/RpcError';
import type {
    ScopedAutomationDefinition,
    ScopedAutomationRecord
} from '../../types/api/scopedautomation';
import {redactSecrets} from '../ai/readEnvelope';
import * as Commander from '../Commander';
import {
    restoreCurrentUserAuthority,
    snapshotJobAuthority
} from '../jobs/control';
import {
    deployNodeRedFlows,
    type FlowRecord,
    fetchNodeRedFlows,
    NodeRedRequestError
} from './flowClient';
import {
    compileScopedAutomation,
    normalizeScopedDefinition,
    removeCompiledFlow,
    replaceCompiledFlow,
    scopedAutomationFlowId
} from './scopedAutomationCompiler';
import {
    type ScopedAutomationInvocationResult,
    scopedAutomationInvocationRepository
} from './scopedAutomationInvocationRepository';
import {
    type ScopedAutomationExecution,
    type ScopedAutomationPrincipal,
    scopedAutomationRepository
} from './scopedAutomationRepository';

type Repository = typeof scopedAutomationRepository;

const logger = log4js.getLogger('scoped-automation');

// A 409 means someone deployed in between; the caller should read and retry.
function deployFailure(error: unknown): unknown {
    if (error instanceof NodeRedRequestError && error.status === 409) {
        return RpcError.Domain('ResourceConflict', {
            message: 'Node-RED flows changed during deployment; try again'
        });
    }
    return error;
}

interface ScopedAutomationServiceDeps {
    repository: Repository;
    invocations: typeof scopedAutomationInvocationRepository;
    fetchFlows(): Promise<{rev: string; flows: FlowRecord[]}>;
    deployFlows(
        revision: string,
        flows: readonly FlowRecord[]
    ): Promise<string>;
    restoreAuthority: typeof restoreCurrentUserAuthority;
    execute(
        sender: CommandSender,
        method: string,
        params: unknown
    ): Promise<unknown>;
    makeToken(): string;
}

const defaultDeps: ScopedAutomationServiceDeps = {
    repository: scopedAutomationRepository,
    invocations: scopedAutomationInvocationRepository,
    fetchFlows: fetchNodeRedFlows,
    deployFlows: deployNodeRedFlows,
    restoreAuthority: restoreCurrentUserAuthority,
    execute: Commander.exec,
    makeToken: () => randomBytes(32).toString('base64url')
};

export function hashScopedAutomationToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function scopedAutomationPrincipal(
    sender: CommandSender,
    tenantId: string
): ScopedAutomationPrincipal {
    const userId = sender.getUserId();
    if (!userId || sender.isTrusted()) {
        throw new Error('scoped automations require an authenticated user');
    }
    return {
        tenantId,
        userId,
        credentialId: sender.getCredentialId() ?? null
    };
}

export class ScopedAutomationService {
    constructor(
        private readonly deps: ScopedAutomationServiceDeps = defaultDeps
    ) {}

    async create(input: {
        id: string;
        definition: ScopedAutomationDefinition;
        tenantId: string;
        sender: CommandSender;
    }): Promise<ScopedAutomationRecord> {
        const definition = normalizeScopedDefinition(input.definition);
        const token = this.deps.makeToken();
        const principal = scopedAutomationPrincipal(
            input.sender,
            input.tenantId
        );
        const authority = snapshotJobAuthority(
            input.sender,
            input.tenantId,
            'execute'
        );
        const draft = await this.deps.repository.createDraft({
            id: input.id,
            definition,
            tokenHash: hashScopedAutomationToken(token),
            authority,
            principal
        });
        const compiled = compileScopedAutomation(draft, token);
        await this.#deploy((flows) =>
            replaceCompiledFlow(
                flows,
                draft.flowId ?? compiled.flowId,
                compiled
            )
        ).catch((error: unknown) =>
            this.#failNewDraft({draft, principal, error})
        );
        return await this.deps.repository.activate({
            id: draft.id,
            expectedRevision: draft.revision,
            flowId: compiled.flowId,
            principal
        });
    }

    async update(input: {
        id: string;
        expectedRevision: number;
        definition: ScopedAutomationDefinition;
        tenantId: string;
        sender: CommandSender;
    }): Promise<ScopedAutomationRecord> {
        const definition = normalizeScopedDefinition(input.definition);
        const token = this.deps.makeToken();
        const principal = scopedAutomationPrincipal(
            input.sender,
            input.tenantId
        );
        const draft = await this.deps.repository.disableForChange({
            id: input.id,
            expectedRevision: input.expectedRevision,
            principal,
            definition,
            tokenHash: hashScopedAutomationToken(token),
            authority: snapshotJobAuthority(
                input.sender,
                input.tenantId,
                'execute'
            )
        });
        const compiled = compileScopedAutomation(draft, token);
        // A failed update leaves the automation switched off, never half on.
        await this.#deploy((flows) =>
            replaceCompiledFlow(flows, draft.flowId, compiled)
        ).catch((error: unknown) => {
            throw deployFailure(error);
        });
        return await this.deps.repository.activate({
            id: draft.id,
            expectedRevision: draft.revision,
            flowId: compiled.flowId,
            principal
        });
    }

    async delete(input: {
        id: string;
        expectedRevision: number;
        tenantId: string;
        sender: CommandSender;
    }): Promise<void> {
        const principal = scopedAutomationPrincipal(
            input.sender,
            input.tenantId
        );
        const draft = await this.deps.repository.disableForChange({
            id: input.id,
            expectedRevision: input.expectedRevision,
            principal
        });
        const current = await this.deps.fetchFlows();
        await this.deps.deployFlows(
            current.rev,
            removeCompiledFlow(
                current.flows,
                draft.flowId ?? scopedAutomationFlowId(draft.id),
                draft.id
            )
        );
        await this.deps.repository.remove({
            id: input.id,
            expectedRevision: draft.revision,
            principal
        });
    }

    async #deploy(
        change: (flows: FlowRecord[]) => readonly FlowRecord[]
    ): Promise<void> {
        const current = await this.deps.fetchFlows();
        await this.deps.deployFlows(current.rev, change(current.flows));
    }

    // A draft that never reached Node-RED is removed, then the deploy error
    // is the one the caller sees.
    async #failNewDraft(input: {
        draft: ScopedAutomationRecord;
        principal: ScopedAutomationPrincipal;
        error: unknown;
    }): Promise<never> {
        await this.#discardDraft(input);
        throw deployFailure(input.error);
    }

    // Best effort: the deploy error is the one the caller needs to see.
    async #discardDraft(input: {
        draft: ScopedAutomationRecord;
        principal: ScopedAutomationPrincipal;
    }): Promise<void> {
        await this.deps.repository
            .remove({
                id: input.draft.id,
                expectedRevision: input.draft.revision,
                principal: input.principal
            })
            .catch((error: unknown) => {
                logger.warn(
                    'Could not remove scoped automation draft %s after a failed deploy: %s',
                    input.draft.id,
                    error
                );
            });
    }

    // A failed lookup counts as a denial so the receipt settles, never wedges.
    async #currentAuthority(
        automation: ScopedAutomationExecution,
        deviceIds: readonly string[]
    ): Promise<CommandSender | null> {
        try {
            const sender = await this.deps.restoreAuthority(
                automation.authority
            );
            return sender &&
                (await canAuthorDeviceScopedAutomation(sender, deviceIds))
                ? sender
                : null;
        } catch (error) {
            logger.warn(
                'Could not check the authority of scoped automation %s: %s',
                automation.id,
                error
            );
            return null;
        }
    }

    async run(input: {
        id: string;
        tenantId: string;
        executionToken: string;
        invocationId?: string;
    }): Promise<ScopedAutomationInvocationResult> {
        const {id, tenantId} = input;
        const receipt = {
            id,
            tenantId,
            tokenHash: hashScopedAutomationToken(input.executionToken),
            invocationId: input.invocationId ?? 'legacy'
        };
        const claim = await this.deps.invocations.claim(receipt);
        if (claim.status === 'not_found') {
            throw RpcError.NotFound('scoped automation', id);
        }
        if (claim.status === 'busy') {
            throw RpcError.Domain('ResourceConflict', {
                message:
                    'automation execution is running or its outcome is unknown'
            });
        }
        const {automation} = claim;
        if (claim.status !== 'claimed') {
            const sender = await this.#currentAuthority(
                automation,
                automation.deviceIds
            );
            if (!sender || claim.status === 'denied') {
                throw RpcError.PermissionDenied(true);
            }
            return claim.result;
        }
        const deviceResults: Array<{deviceId: string; result: unknown}> = [];
        for (const deviceId of automation.deviceIds) {
            const sender = await this.#currentAuthority(automation, [deviceId]);
            if (!sender) {
                if (deviceResults.length === 0) {
                    await this.deps.invocations.finish({
                        ...receipt,
                        result: {id, deviceResults},
                        denied: true
                    });
                }
                throw RpcError.PermissionDenied(true);
            }
            deviceResults.push({
                deviceId,
                result: redactSecrets(
                    await this.deps.execute(sender, 'Device.Call', {
                        shellyID: deviceId,
                        method: automation.method,
                        params: automation.params ?? {}
                    })
                )
            });
        }
        const result = {id, deviceResults};
        if (!(await this.deps.invocations.finish({...receipt, result}))) {
            throw RpcError.Domain('ResourceConflict', {
                message: 'automation execution could not be settled'
            });
        }
        return result;
    }
}

export const scopedAutomationService = new ScopedAutomationService();
