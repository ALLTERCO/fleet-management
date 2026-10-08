import * as postgres from '../PostgresProvider';
import type {ScopedAutomationExecution} from './scopedAutomationRepository';

export interface ScopedAutomationInvocationResult {
    id: string;
    deviceResults: Array<{deviceId: string; result: unknown}>;
}

export interface ScopedAutomationInvocationIdentity {
    id: string;
    tenantId: string;
    tokenHash: string;
    invocationId: string;
}

export type ScopedAutomationInvocationClaim =
    | {status: 'claimed'; automation: ScopedAutomationExecution}
    | {
          status: 'completed';
          automation: ScopedAutomationExecution;
          result: ScopedAutomationInvocationResult;
      }
    | {status: 'denied'; automation: ScopedAutomationExecution}
    | {status: 'busy'}
    | {status: 'not_found'};

interface InvocationRow {
    status: ScopedAutomationInvocationClaim['status'];
    automation_json: AutomationJson | null;
    result_json: ScopedAutomationInvocationResult | null;
}

interface AutomationJson {
    id: string;
    name: string;
    device_ids: string[];
    schedule_json: ScopedAutomationExecution['schedule'];
    method: string;
    params_json: Record<string, unknown>;
    deployment_state: 'draft' | 'active' | 'revoked';
    execution_state: 'idle' | 'unknown';
    revision: number | string;
    flow_id: string | null;
    authority_json: ScopedAutomationExecution['authority'];
    created_at: string;
    updated_at: string;
}

type CallDb = typeof postgres.callMethod;

function automationFromJson(row: AutomationJson): ScopedAutomationExecution {
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
        authority: row.authority_json,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
    };
}

function firstRow(result: unknown): InvocationRow | undefined {
    return (result as {rows?: InvocationRow[]})?.rows?.[0];
}

export function createScopedAutomationInvocationRepository(
    callDb: CallDb = postgres.callMethod
) {
    return {
        async claim(
            input: ScopedAutomationInvocationIdentity
        ): Promise<ScopedAutomationInvocationClaim> {
            const result = await callDb(
                'fm.fn_scoped_automation_invocation_claim',
                {
                    p_id: input.id,
                    p_tenant_id: input.tenantId,
                    p_token_hash: input.tokenHash,
                    p_invocation_id: input.invocationId
                }
            );
            const row = firstRow(result);
            if (!row || row.status === 'not_found') {
                return {status: 'not_found'};
            }
            if (row.status === 'busy') return {status: 'busy'};
            if (!row.automation_json) {
                throw new Error('scoped automation claim omitted automation');
            }
            const automation = automationFromJson(row.automation_json);
            if (row.status === 'denied') return {status: 'denied', automation};
            if (row.status === 'completed') {
                if (!row.result_json) {
                    throw new Error('completed invocation omitted result');
                }
                return {
                    status: 'completed',
                    automation,
                    result: row.result_json
                };
            }
            return {status: 'claimed', automation};
        },

        async finish(
            input: ScopedAutomationInvocationIdentity & {
                result: ScopedAutomationInvocationResult;
                denied?: boolean;
            }
        ): Promise<boolean> {
            const result = await callDb(
                'fm.fn_scoped_automation_invocation_finish',
                {
                    p_id: input.id,
                    p_tenant_id: input.tenantId,
                    p_token_hash: input.tokenHash,
                    p_invocation_id: input.invocationId,
                    p_result: JSON.stringify(input.result),
                    p_denied: input.denied ?? false
                }
            );
            return postgres.extractScalarBoolean(result);
        }
    };
}

export const scopedAutomationInvocationRepository =
    createScopedAutomationInvocationRepository();
