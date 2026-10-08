import RpcError from '../../rpc/RpcError';
import type {
    ScopedAutomationDefinition,
    ScopedAutomationRecord
} from '../../types/api/scopedautomation';
import type {JobAuthority} from '../jobs/repository';
import * as postgres from '../PostgresProvider';

export interface ScopedAutomationPrincipal {
    tenantId: string;
    userId: string;
    credentialId: string | null;
}

export interface ScopedAutomationExecution extends ScopedAutomationRecord {
    authority: Extract<JobAuthority, {kind: 'user'}>;
}

interface ScopedAutomationRow {
    id: string;
    name: string;
    device_ids: string[];
    schedule_json: ScopedAutomationRecord['schedule'];
    method: string;
    params_json: Record<string, unknown>;
    deployment_state: 'draft' | 'active' | 'revoked';
    execution_state: 'idle' | 'unknown';
    revision: number | string;
    flow_id: string | null;
    authority_json?: Extract<JobAuthority, {kind: 'user'}>;
    created_at: Date | string;
    updated_at: Date | string;
}

type CallDb = typeof postgres.callMethod;

const defaultCallDb: CallDb = postgres.callMethod;

function rows(result: unknown): ScopedAutomationRow[] {
    return ((result as {rows?: ScopedAutomationRow[]})?.rows ?? []).map(
        (row) => row
    );
}

function toRecord(row: ScopedAutomationRow): ScopedAutomationRecord {
    return {
        id: row.id,
        name: row.name,
        deviceIds: row.device_ids,
        schedule: row.schedule_json,
        method: row.method,
        params: row.params_json,
        enabled: row.deployment_state === 'active',
        state:
            row.execution_state === 'unknown'
                ? 'unknown'
                : row.deployment_state,
        revision: Number(row.revision),
        flowId: row.flow_id,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
    };
}

function ownerArgs(principal: ScopedAutomationPrincipal) {
    return {
        p_tenant_id: principal.tenantId,
        p_owner_user_id: principal.userId,
        p_owner_credential_id: principal.credentialId
    };
}

export function createScopedAutomationRepository(
    callDb: CallDb = defaultCallDb
) {
    return {
        async createDraft(input: {
            id: string;
            definition: ScopedAutomationDefinition;
            tokenHash: string;
            authority: Extract<JobAuthority, {kind: 'user'}>;
            principal: ScopedAutomationPrincipal;
        }): Promise<ScopedAutomationRecord> {
            const result = await callDb(
                'fm.fn_scoped_automation_create_draft',
                {
                    p_id: input.id,
                    ...ownerArgs(input.principal),
                    p_name: input.definition.name,
                    p_device_ids: input.definition.deviceIds,
                    p_schedule: JSON.stringify(input.definition.schedule),
                    p_method: input.definition.method,
                    p_params: JSON.stringify(input.definition.params ?? {}),
                    p_token_hash: input.tokenHash,
                    p_authority: JSON.stringify(input.authority)
                }
            );
            return requireRecord(result, input.id);
        },

        async list(
            principal: ScopedAutomationPrincipal,
            limit: number,
            offset: number
        ): Promise<{items: ScopedAutomationRecord[]; total: number}> {
            const result = await callDb('fm.fn_scoped_automation_list', {
                ...ownerArgs(principal),
                p_limit: limit,
                p_offset: offset
            });
            const found = rows(result);
            return {
                items: found.map(toRecord),
                total: Number(
                    (found[0] as ScopedAutomationRow & {total_count?: unknown})
                        ?.total_count ?? 0
                )
            };
        },

        async get(
            id: string,
            principal: ScopedAutomationPrincipal
        ): Promise<ScopedAutomationRecord | null> {
            const result = await callDb('fm.fn_scoped_automation_get', {
                p_id: id,
                ...ownerArgs(principal)
            });
            const row = rows(result)[0];
            return row ? toRecord(row) : null;
        },

        async disableForChange(input: {
            id: string;
            expectedRevision: number;
            principal: ScopedAutomationPrincipal;
            definition?: ScopedAutomationDefinition;
            tokenHash?: string;
            authority?: Extract<JobAuthority, {kind: 'user'}>;
        }): Promise<ScopedAutomationRecord> {
            const result = await callDb('fm.fn_scoped_automation_disable', {
                p_id: input.id,
                ...ownerArgs(input.principal),
                p_expected_revision: input.expectedRevision,
                p_definition: input.definition
                    ? JSON.stringify(input.definition)
                    : null,
                p_token_hash: input.tokenHash ?? null,
                p_authority: input.authority
                    ? JSON.stringify(input.authority)
                    : null
            });
            return requireRecord(result, input.id);
        },

        async activate(input: {
            id: string;
            expectedRevision: number;
            flowId: string;
            principal: ScopedAutomationPrincipal;
        }): Promise<ScopedAutomationRecord> {
            const result = await callDb('fm.fn_scoped_automation_activate', {
                p_id: input.id,
                ...ownerArgs(input.principal),
                p_expected_revision: input.expectedRevision,
                p_flow_id: input.flowId
            });
            return requireRecord(result, input.id);
        },

        async remove(input: {
            id: string;
            expectedRevision: number;
            principal: ScopedAutomationPrincipal;
        }): Promise<void> {
            const result = await callDb('fm.fn_scoped_automation_delete', {
                p_id: input.id,
                ...ownerArgs(input.principal),
                p_expected_revision: input.expectedRevision
            });
            if (!postgres.extractScalarBoolean(result)) {
                throw RpcError.Domain('ResourceConflict', {
                    message: 'scoped automation changed before deletion'
                });
            }
        },

        async beginExecution(
            id: string,
            tenantId: string,
            tokenHash: string
        ): Promise<ScopedAutomationExecution | null> {
            const result = await callDb('fm.fn_scoped_automation_begin_run', {
                p_id: id,
                p_tenant_id: tenantId,
                p_token_hash: tokenHash
            });
            const row = rows(result)[0];
            if (!row?.authority_json) return null;
            return {...toRecord(row), authority: row.authority_json};
        },

        async finishExecution(id: string, tokenHash: string): Promise<void> {
            await callDb('fm.fn_scoped_automation_finish_run', {
                p_id: id,
                p_token_hash: tokenHash
            });
        }
    };
}

function requireRecord(result: unknown, id: string): ScopedAutomationRecord {
    const row = rows(result)[0];
    if (!row) throw new Error(`scoped automation ${id} was not changed`);
    return toRecord(row);
}

export const scopedAutomationRepository = createScopedAutomationRepository();
