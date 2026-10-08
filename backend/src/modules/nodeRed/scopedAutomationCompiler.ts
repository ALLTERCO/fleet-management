import {createHash} from 'node:crypto';
import type {
    ScopedAutomationDefinition,
    ScopedAutomationRecord
} from '../../types/api/scopedautomation';
import type {FlowRecord} from './flowClient';

export interface CompiledScopedAutomation {
    flowId: string;
    records: FlowRecord[];
}

const SCOPED_FLOW_MARKER = 'Fleet Manager device-scoped automation';

function nodeId(automationId: string, role: string): string {
    const digest = createHash('sha256').update(automationId).digest('hex');
    return `${digest.slice(0, 12)}${createHash('sha256').update(role).digest('hex').slice(0, 4)}`;
}

export function scopedAutomationFlowId(automationId: string): string {
    return nodeId(automationId, 'flow');
}

export function compileScopedAutomation(
    automation: Pick<ScopedAutomationRecord, 'id' | 'name' | 'schedule'>,
    executionToken: string
): CompiledScopedAutomation {
    const flowId = scopedAutomationFlowId(automation.id);
    const triggerId = nodeId(automation.id, 'trigger');
    const paramsId = nodeId(automation.id, 'params');
    const actionId = nodeId(automation.id, 'run');
    const serverId = nodeId(automation.id, 'server');
    const schedule = automation.schedule;
    return {
        flowId,
        records: [
            {
                id: flowId,
                type: 'tab',
                label: automation.name,
                disabled: false,
                info: SCOPED_FLOW_MARKER
            },
            {
                id: triggerId,
                type: 'inject',
                z: flowId,
                name:
                    schedule.kind === 'cron'
                        ? `At ${schedule.expression}`
                        : `Every ${schedule.seconds}s`,
                props: [],
                repeat:
                    schedule.kind === 'timer' ? String(schedule.seconds) : '',
                crontab: schedule.kind === 'cron' ? schedule.expression : '',
                once: false,
                x: 180,
                y: 180,
                wires: [[paramsId]]
            },
            {
                id: paramsId,
                type: 'change',
                z: flowId,
                name: 'Prepare scoped invocation',
                rules: [
                    {
                        t: 'set',
                        p: 'params',
                        pt: 'msg',
                        to: JSON.stringify({
                            id: automation.id,
                            executionToken
                        }),
                        tot: 'json'
                    },
                    {
                        t: 'set',
                        p: 'params.invocationId',
                        pt: 'msg',
                        to: '_msgid',
                        tot: 'msg'
                    }
                ],
                action: '',
                property: '',
                from: '',
                to: '',
                reg: false,
                x: 450,
                y: 180,
                wires: [[actionId]]
            },
            {
                id: actionId,
                type: 'fm-rpc',
                z: flowId,
                name: 'Run scoped automation',
                server: serverId,
                operation: 'ScopedAutomation.Run',
                paramsSource: 'auto',
                paramsJson: JSON.stringify({
                    id: automation.id,
                    executionToken
                }),
                x: 720,
                y: 180,
                wires: [[]]
            },
            {
                id: serverId,
                type: 'fm-server',
                z: flowId,
                name: `Scoped ${automation.name}`,
                baseUrl: '',
                wsUrl: ''
            }
        ]
    };
}

export function replaceCompiledFlow(
    current: readonly FlowRecord[],
    flowId: string | null,
    compiled: CompiledScopedAutomation
): FlowRecord[] {
    assertOwnedFlow(current, flowId, automationIdIn(compiled.records));
    const withoutOld = flowId
        ? current.filter(
              (record) => record.id !== flowId && record.z !== flowId
          )
        : [...current];
    const ids = new Set(withoutOld.map((record) => String(record.id)));
    if (compiled.records.some((record) => ids.has(String(record.id)))) {
        throw new Error('scoped automation Node-RED id collision');
    }
    return [...withoutOld, ...compiled.records];
}

export function removeCompiledFlow(
    current: readonly FlowRecord[],
    flowId: string,
    automationId: string
): FlowRecord[] {
    assertOwnedFlow(current, flowId, automationId);
    return current.filter(
        (record) => record.id !== flowId && record.z !== flowId
    );
}

function assertOwnedFlow(
    records: readonly FlowRecord[],
    flowId: string | null,
    automationId: string | null
): void {
    if (!flowId) return;
    const tab = records.find((record) => record.id === flowId);
    if (!tab) return;
    const ownedCall = records.some((record) => {
        if (
            record.z !== flowId ||
            record.operation !== 'ScopedAutomation.Run'
        ) {
            return false;
        }
        try {
            const params = JSON.parse(String(record.paramsJson)) as {
                id?: unknown;
            };
            return params.id === automationId;
        } catch {
            return false;
        }
    });
    if (tab.info !== SCOPED_FLOW_MARKER || !ownedCall) {
        throw new Error('refusing to replace a non-scoped Node-RED flow');
    }
}

function automationIdIn(records: readonly FlowRecord[]): string | null {
    const call = records.find(
        (record) => record.operation === 'ScopedAutomation.Run'
    );
    if (!call) return null;
    try {
        const params = JSON.parse(String(call.paramsJson)) as {id?: unknown};
        return typeof params.id === 'string' ? params.id : null;
    } catch {
        return null;
    }
}

export function normalizeScopedDefinition(
    input: ScopedAutomationDefinition
): ScopedAutomationDefinition {
    return {
        name: input.name.trim(),
        deviceIds: [...new Set(input.deviceIds.map((id) => id.trim()))].sort(),
        schedule:
            input.schedule.kind === 'cron'
                ? {
                      kind: 'cron',
                      expression: input.schedule.expression.trim()
                  }
                : {...input.schedule},
        method: input.method.trim(),
        params: input.params ?? {}
    };
}
