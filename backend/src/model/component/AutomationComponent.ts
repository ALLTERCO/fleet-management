// Node-RED automations over RPC.
//
// Who may do this, how to reach Node-RED, and what an automation is all live in
// modules/nodeRed. This file only validates, calls and returns. It holds no
// rule, so the editor and the API cannot disagree.

import * as crypto from 'node:crypto';
import {activityStore} from '../../modules/nodeRed/activityStore';
import {nodeRedAvailable} from '../../modules/nodeRed/available';
import {
    createNodeRedFlow,
    deployNodeRedFlows,
    type FlowObject,
    fetchInstalledNodeRed,
    fetchNodeRedFlows,
    type InstalledNodeRed,
    NodeRedRequestError,
    updateNodeRedFlow
} from '../../modules/nodeRed/flowClient';
import {
    createFlowGraph,
    deleteFlowGraph,
    putFlowGraph,
    ReferencedGlobalGraphRecord,
    readFlowGraph,
    readFlowGraphPage,
    restoreRedactedGraph,
    UnresolvedGraphRedaction,
    validateFlowGraph
} from '../../modules/nodeRed/flowGraph';
import {
    type AutomationRecipe,
    buildRecipeFlow,
    existingNodeIds,
    parseAction,
    parseTarget,
    parseTrigger,
    readRecipe
} from '../../modules/nodeRed/flowRecipe';
import {scopeResolverFor} from '../../modules/nodeRed/flowScopeMembers';
import {
    actingNodeScopes,
    describeFlowChange,
    findFlow,
    type NodeRedFlow,
    summarizeFlowSet,
    withFlowEnabled
} from '../../modules/nodeRed/flows';
import {nodeConfigurationValidationCoverage} from '../../modules/nodeRed/nodeConfigurationValidation';
import {
    NODE_RED_WRONG_ORGANIZATION,
    nodeRedOrgAllows
} from '../../modules/nodeRed/orgLock';
import {isNodeRedServiceSender} from '../../modules/nodeRed/serviceIdentity';
import {readNodeRedStatus} from '../../modules/nodeRed/statusProbe';
import type {DescribeOutput} from '../../rpc/describe';
import RpcError from '../../rpc/RpcError';
import {validateOrThrow} from '../../rpc/validateOrThrow';
import {
    AUTOMATION_CREATE_PARAMS_SCHEMA,
    AUTOMATION_DELETE_PARAMS_SCHEMA,
    AUTOMATION_DESCRIBE,
    AUTOMATION_GET_ACTIVITY_PARAMS_SCHEMA,
    AUTOMATION_GET_PARAMS_SCHEMA,
    AUTOMATION_GET_STATUS_PARAMS_SCHEMA,
    AUTOMATION_GRAPH_CREATE_PARAMS_SCHEMA,
    AUTOMATION_GRAPH_DELETE_PARAMS_SCHEMA,
    AUTOMATION_GRAPH_GET_PARAMS_SCHEMA,
    AUTOMATION_GRAPH_READ_PAGE_PARAMS_SCHEMA,
    AUTOMATION_GRAPH_UPDATE_PARAMS_SCHEMA,
    AUTOMATION_GRAPH_VALIDATE_PARAMS_SCHEMA,
    AUTOMATION_LIST_ENGINES_PARAMS_SCHEMA,
    AUTOMATION_LIST_PARAMS_SCHEMA,
    AUTOMATION_REPORT_ACTIVITY_PARAMS_SCHEMA,
    AUTOMATION_SET_ENABLED_PARAMS_SCHEMA,
    AUTOMATION_UPDATE_PARAMS_SCHEMA,
    type AutomationCreateParams,
    type AutomationDeleteParams,
    type AutomationEngine,
    type AutomationGetActivityParams,
    type AutomationGetParams,
    type AutomationGetStatusParams,
    type AutomationGraphCreateParams,
    type AutomationGraphDeleteParams,
    type AutomationGraphGetParams,
    type AutomationGraphReadPageParams,
    type AutomationGraphUpdateParams,
    type AutomationGraphValidateParams,
    type AutomationListEnginesParams,
    type AutomationListParams,
    type AutomationReportActivityParams,
    type AutomationSetEnabledParams,
    type AutomationUpdateParams
} from '../../types/api/automation';
import type CommandSender from '../CommandSender';
import {canManageThisNodeRed} from './authzPermissions';
import Component from './Component';

// Activity comes from the nodes themselves, never from a person.
function isThisNodeRedService(sender: CommandSender): boolean {
    return (
        isNodeRedServiceSender(sender) &&
        nodeRedOrgAllows(sender.getOrganizationId())
    );
}

// "No Node-RED here" and "no such automation" send an operator two different
// places. Say which.
function assertNodeRedPresent(): void {
    if (!nodeRedAvailable()) {
        throw new Error('Node-RED is not installed or not enabled');
    }
}

// Groups, places, tags and the fleet expand to the caller organization's devices.
async function summarizeFlowsWithMembers(
    sender: CommandSender
): Promise<NodeRedFlow[]> {
    const payload = await fetchNodeRedFlows();
    const resolve = await scopeResolverFor({
        organizationId: sender.getOrganizationId(),
        scopes: actingNodeScopes(payload.flows)
    });
    return summarizeFlowSet(payload, resolve);
}

// Node-RED's own id format: 16 hex characters.
function newNodeId(): string {
    return crypto.randomBytes(8).toString('hex');
}

// The only engine today. When a second lands, its per-engine options go in a
// sibling hash keyed by this value (engine:'node_red' + node_red:{...}), the
// way Stripe keys payment-method config. That stays machine-checkable; a shared
// opaque options bag does not.
const NODE_RED: AutomationEngine = 'node_red';

function assertValidGraph(
    graph: AutomationGraphCreateParams['graph'],
    flowId: string | undefined,
    installed: InstalledNodeRed,
    records: readonly Record<string, unknown>[]
): void {
    const issues = validateFlowGraph(graph, flowId, {
        installedNodeTypes: installed.types,
        nodeDefinitions: installed.definitions,
        knownSubflowIds: knownSubflowIds(records, flowId),
        knownConfigurationRecords:
            flowId === 'global' ? [] : readFlowGraph(records, 'global')?.configs
    });
    if (issues.length === 0) return;
    throw RpcError.InvalidParams(
        'Node-RED graph failed validation',
        issues.map((issue) => ({
            field: issue.path,
            error: issue.message,
            code: issue.code
        }))
    );
}

function knownSubflowIds(
    records: readonly Record<string, unknown>[],
    flowId?: string
): Set<string> {
    if (flowId === 'global') return new Set();
    return new Set(
        records
            .filter((record) => record.type === 'subflow')
            .map((record) => String(record.id))
    );
}

function graphFromFlowObject(flow: FlowObject) {
    return {
        properties: {
            label: flow.label,
            ...(flow.disabled === undefined ? {} : {disabled: flow.disabled})
        },
        nodes: flow.nodes,
        configs: flow.configs ?? [],
        subflows: []
    };
}

function invalidGraphOffset(message: string): never {
    throw RpcError.InvalidParams(message, [
        {field: 'offset', error: message, code: 'graph_page_offset'}
    ]);
}

function assertCurrentRevision(actual: string, expected: string): void {
    if (actual === expected) return;
    throw RpcError.Domain('ResourceConflict', {
        message: 'Node-RED graph changed after it was read',
        details: {expectedRevision: expected, actualRevision: actual}
    });
}

function restoreStoredGraphValues(
    proposed: AutomationGraphUpdateParams['graph'],
    current: AutomationGraphUpdateParams['graph']
): AutomationGraphUpdateParams['graph'] {
    try {
        return restoreRedactedGraph(proposed, current);
    } catch (error) {
        if (error instanceof UnresolvedGraphRedaction) {
            throw RpcError.InvalidParams(error.message, [
                {
                    field: 'graph',
                    error: error.message,
                    code: 'unresolved_redaction'
                }
            ]);
        }
        throw error;
    }
}

async function deployGraph(
    revision: string,
    records: Parameters<typeof deployNodeRedFlows>[1]
): Promise<string> {
    try {
        return await deployNodeRedFlows(revision, records);
    } catch (error) {
        if (error instanceof NodeRedRequestError && error.status === 409) {
            throw RpcError.Domain('ResourceConflict', {
                message: 'Node-RED graph changed during deployment'
            });
        }
        throw error;
    }
}

function replaceGraph(
    records: Parameters<typeof putFlowGraph>[0],
    flowId: string,
    graph: Parameters<typeof putFlowGraph>[2]
) {
    try {
        return putFlowGraph(records, flowId, graph);
    } catch (error) {
        if (error instanceof ReferencedGlobalGraphRecord) {
            throw RpcError.InvalidParams(error.message, [
                {
                    field: 'graph',
                    error: error.message,
                    code: 'referenced_global_record'
                }
            ]);
        }
        throw error;
    }
}

export default class AutomationComponent extends Component<any> {
    constructor() {
        super('automation', {
            set_config_methods: false,
            auto_apply_config: false
        });
    }

    // Same reason code as the editor proxy, so the UI can name the problem.
    protected override permissionDeniedError(sender: CommandSender): RpcError {
        const wrongOrganization =
            sender.isAuthenticated() &&
            !nodeRedOrgAllows(sender.getOrganizationId());
        if (!wrongOrganization) {
            return super.permissionDeniedError(sender);
        }
        return RpcError.Domain('PermissionDenied', {
            message: 'This Node-RED belongs to another organization.',
            details: {reason: NODE_RED_WRONG_ORGANIZATION}
        });
    }

    @Component.NoAudit
    @Component.Expose('Describe')
    @Component.NoPermissions
    describe(): DescribeOutput {
        return AUTOMATION_DESCRIBE;
    }

    @Component.Expose('List')
    @Component.CheckPermissions(canManageThisNodeRed)
    async list(params: unknown, sender: CommandSender) {
        const v = validateOrThrow<AutomationListParams>(
            params,
            AUTOMATION_LIST_PARAMS_SCHEMA
        );
        if (!nodeRedAvailable()) {
            return {
                items: [],
                available: false,
                note: 'Node-RED is not installed or not enabled on this Fleet Manager.'
            };
        }
        // An engine filter naming something we do not run means an empty list,
        // not everything. Asking for another engine's automations and getting
        // Node-RED's would be the wrong answer, quietly.
        if (v.engine !== undefined && v.engine !== NODE_RED) {
            return {items: [], available: true};
        }
        const flows = await summarizeFlowsWithMembers(sender);
        const items = (
            v.includeDisabled === false
                ? flows.filter((flow) => !flow.disabled)
                : flows
        ).map((flow) => ({...flow, engine: NODE_RED}));
        return {items, available: true};
    }

    // Polled by the nodes after each run; failures still reach the audit log.
    @Component.NoAudit
    @Component.Expose('ReportActivity')
    @Component.CheckPermissions(isThisNodeRedService)
    reportActivity(params: unknown) {
        const v = validateOrThrow<AutomationReportActivityParams>(
            params,
            AUTOMATION_REPORT_ACTIVITY_PARAMS_SCHEMA
        );
        activityStore.record(v);
        return {recorded: true};
    }

    @Component.Expose('GetActivity')
    @Component.CheckPermissions(canManageThisNodeRed)
    getActivity(params: unknown) {
        const v = validateOrThrow<AutomationGetActivityParams>(
            params,
            AUTOMATION_GET_ACTIVITY_PARAMS_SCHEMA
        );
        return {items: activityStore.read(v.flowId)};
    }

    // Polled by the UI; the probe answer is cached, so no audit row per poll.
    @Component.NoAudit
    @Component.Expose('GetStatus')
    @Component.CheckPermissions(canManageThisNodeRed)
    async rpcGetStatus(params: unknown) {
        validateOrThrow<AutomationGetStatusParams>(
            params,
            AUTOMATION_GET_STATUS_PARAMS_SCHEMA
        );
        return await readNodeRedStatus();
    }

    @Component.Expose('ListEngines')
    @Component.CheckPermissions(canManageThisNodeRed)
    async listEngines(params: unknown) {
        // Takes nothing, and says so: a caller passing an engine filter here is
        // confusing this with List, and should be told rather than ignored.
        validateOrThrow<AutomationListEnginesParams>(
            params,
            AUTOMATION_LIST_ENGINES_PARAMS_SCHEMA
        );
        const available = nodeRedAvailable();
        return {
            items: [
                {
                    engine: NODE_RED,
                    label: 'Node-RED',
                    available,
                    canCreate: available,
                    canEdit: available,
                    ...(available
                        ? {}
                        : {
                              note: 'Node-RED is not installed or not enabled on this Fleet Manager.'
                          })
                }
            ]
        };
    }

    @Component.Expose('Get')
    @Component.CheckPermissions(canManageThisNodeRed)
    async get(params: unknown) {
        const v = validateOrThrow<AutomationGetParams>(
            params,
            AUTOMATION_GET_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const payload = await fetchNodeRedFlows();
        const flow = findFlow(summarizeFlowSet(payload), v.flowId);
        if (!flow) throw new Error(`no automation with id ${v.flowId}`);
        const recipe = readRecipe(payload.flows ?? [], v.flowId);
        return {
            flowId: flow.id,
            engine: NODE_RED,
            label: flow.label,
            disabled: flow.disabled,
            nodeCount: flow.nodeCount,
            usesFleetManager: flow.usesFleetManager,
            // False means it was built by hand and only the editor can change
            // it safely. SetEnabled and Delete still work on it.
            editable: recipe !== null,
            ...(recipe ? {recipe} : {})
        };
    }

    @Component.Expose('Graph.Get')
    @Component.CheckPermissions(canManageThisNodeRed)
    async getGraph(params: unknown) {
        const v = validateOrThrow<AutomationGraphGetParams>(
            params,
            AUTOMATION_GRAPH_GET_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const payload = await fetchNodeRedFlows();
        const graph = readFlowGraph(payload.flows, v.flowId);
        if (!graph) throw RpcError.NotFound('automation graph', v.flowId);
        return {flowId: v.flowId, revision: payload.rev, complete: true, graph};
    }

    @Component.Expose('Graph.ReadPage')
    @Component.CheckPermissions(canManageThisNodeRed)
    async readGraphPage(params: unknown) {
        const v = validateOrThrow<AutomationGraphReadPageParams>(
            params,
            AUTOMATION_GRAPH_READ_PAGE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const offset = v.offset ?? 0;
        if (offset > 0 && !v.expectedRevision) {
            invalidGraphOffset(
                'expectedRevision is required after the first graph page'
            );
        }
        const payload = await fetchNodeRedFlows();
        if (v.expectedRevision) {
            assertCurrentRevision(payload.rev, v.expectedRevision);
        }
        const graph = readFlowGraph(payload.flows, v.flowId);
        if (!graph) throw RpcError.NotFound('automation graph', v.flowId);
        try {
            return {
                flowId: v.flowId,
                revision: payload.rev,
                ...readFlowGraphPage(graph, offset, v.limit ?? 100)
            };
        } catch (error) {
            if (error instanceof RangeError) invalidGraphOffset(error.message);
            throw error;
        }
    }

    @Component.Expose('Graph.Validate')
    @Component.CheckPermissions(canManageThisNodeRed)
    async validateGraph(params: unknown) {
        const v = validateOrThrow<AutomationGraphValidateParams>(
            params,
            AUTOMATION_GRAPH_VALIDATE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const [payload, installed] = await Promise.all([
            fetchNodeRedFlows(),
            fetchInstalledNodeRed()
        ]);
        const issues = validateFlowGraph(v.graph, v.flowId, {
            installedNodeTypes: installed.types,
            nodeDefinitions: installed.definitions,
            knownSubflowIds: knownSubflowIds(payload.flows, v.flowId),
            knownConfigurationRecords:
                v.flowId === 'global'
                    ? []
                    : readFlowGraph(payload.flows, 'global')?.configs
        });
        return {
            valid: issues.length === 0,
            issues,
            coverage: nodeConfigurationValidationCoverage(
                installed.types,
                installed.definitions
            )
        };
    }

    @Component.Expose('Graph.Create')
    @Component.CheckPermissions(canManageThisNodeRed)
    async createGraph(params: unknown) {
        const v = validateOrThrow<AutomationGraphCreateParams>(
            params,
            AUTOMATION_GRAPH_CREATE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const [payload, installed] = await Promise.all([
            fetchNodeRedFlows(),
            fetchInstalledNodeRed()
        ]);
        assertValidGraph(v.graph, undefined, installed, payload.flows);
        let flowId = newNodeId();
        const ids = new Set(payload.flows.map((record) => String(record.id)));
        while (ids.has(flowId)) flowId = newNodeId();
        const next = createFlowGraph(payload.flows, flowId, v.graph);
        const revision = await deployGraph(payload.rev, next);
        return {
            flowId,
            revision,
            summary: `Created the Node-RED graph "${String(v.graph.properties.label)}".`
        };
    }

    @Component.Expose('Graph.Update')
    @Component.CheckPermissions(canManageThisNodeRed)
    async updateGraph(params: unknown) {
        const v = validateOrThrow<AutomationGraphUpdateParams>(
            params,
            AUTOMATION_GRAPH_UPDATE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const [payload, installed] = await Promise.all([
            fetchNodeRedFlows(),
            fetchInstalledNodeRed()
        ]);
        assertValidGraph(v.graph, v.flowId, installed, payload.flows);
        const current = readFlowGraph(payload.flows, v.flowId);
        if (!current) {
            throw RpcError.NotFound('automation graph', v.flowId);
        }
        assertCurrentRevision(payload.rev, v.expectedRevision);
        const next = replaceGraph(
            payload.flows,
            v.flowId,
            restoreStoredGraphValues(v.graph, current)
        );
        const revision = await deployGraph(payload.rev, next);
        return {
            flowId: v.flowId,
            revision,
            summary: `Updated the Node-RED graph ${v.flowId}.`
        };
    }

    @Component.Expose('Graph.Delete')
    @Component.CheckPermissions(canManageThisNodeRed)
    async deleteGraph(params: unknown) {
        const v = validateOrThrow<AutomationGraphDeleteParams>(
            params,
            AUTOMATION_GRAPH_DELETE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const payload = await fetchNodeRedFlows();
        if (!readFlowGraph(payload.flows, v.flowId)) {
            throw RpcError.NotFound('automation graph', v.flowId);
        }
        assertCurrentRevision(payload.rev, v.expectedRevision);
        const next = deleteFlowGraph(payload.flows, v.flowId);
        const revision = await deployGraph(payload.rev, next);
        return {
            flowId: v.flowId,
            revision,
            summary: `Deleted the Node-RED graph ${v.flowId}.`
        };
    }

    @Component.Expose('Create')
    @Component.CheckPermissions(canManageThisNodeRed)
    async create(params: unknown) {
        const v = validateOrThrow<AutomationCreateParams>(
            params,
            AUTOMATION_CREATE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        if (v.engine !== undefined && v.engine !== NODE_RED) {
            throw new Error(
                `this Fleet Manager cannot run ${v.engine} automations`
            );
        }
        const recipe: AutomationRecipe = {
            name: v.name,
            when: parseTrigger(v.when),
            who: parseTarget(v.who),
            what: parseAction(v.what)
        };
        const [payload, installed] = await Promise.all([
            fetchNodeRedFlows(),
            fetchInstalledNodeRed()
        ]);
        const flow = buildRecipeFlow(recipe, {
            existing: payload.flows ?? [],
            newId: newNodeId
        });
        assertValidGraph(
            graphFromFlowObject(flow),
            undefined,
            installed,
            payload.flows
        );
        // Node-RED assigns the real id and rewrites every node's z to match.
        const flowId = await createNodeRedFlow(flow);
        return {
            flowId,
            summary: `Created the automation "${recipe.name}". It runs from now on.`
        };
    }

    @Component.Expose('Update')
    @Component.CheckPermissions(canManageThisNodeRed)
    async update(params: unknown) {
        const v = validateOrThrow<AutomationUpdateParams>(
            params,
            AUTOMATION_UPDATE_PARAMS_SCHEMA
        );
        assertNodeRedPresent();
        const [payload, installed] = await Promise.all([
            fetchNodeRedFlows(),
            fetchInstalledNodeRed()
        ]);
        const existing = payload.flows ?? [];
        const flow = findFlow(summarizeFlowSet(payload), v.flowId);
        if (!flow) throw RpcError.NotFound('automation', v.flowId);
        const current = readRecipe(existing, v.flowId);
        // Refusing beats guessing. Rewriting a hand-built flow into the recipe
        // shape would silently delete every node that does not fit it.
        if (!current) {
            throw new Error(
                `automation ${v.flowId} was not built from a recipe; change it in the Node-RED editor`
            );
        }
        // Anything omitted keeps what it had.
        const next: AutomationRecipe = {
            name: v.name ?? current.name,
            when: v.when ? parseTrigger(v.when) : current.when,
            who: v.who ? parseTarget(v.who) : current.who,
            what: v.what ? parseAction(v.what) : current.what
        };
        const updatedFlow = {
            ...buildRecipeFlow(next, {
                existing,
                newId: newNodeId,
                flowId: v.flowId,
                // Keeping the node ids makes this an edit in the editor rather
                // than a delete plus an unrelated add.
                keep: existingNodeIds(existing, v.flowId)
            }),
            disabled: flow.disabled
        };
        assertValidGraph(
            graphFromFlowObject(updatedFlow),
            v.flowId,
            installed,
            existing
        );
        await updateNodeRedFlow(v.flowId, updatedFlow);
        return {
            flowId: v.flowId,
            summary: `Changed the automation "${next.name}".`
        };
    }

    @Component.Expose('SetEnabled')
    @Component.CheckPermissions(canManageThisNodeRed)
    async setEnabled(params: unknown) {
        const v = validateOrThrow<AutomationSetEnabledParams>(
            params,
            AUTOMATION_SET_ENABLED_PARAMS_SCHEMA
        );
        const {payload, flow} = await this.#readFlow(v.flowId);
        // Only the tab's own `disabled` changes. Node-RED can disable single
        // nodes too, and rewriting those would undo choices made inside.
        await deployGraph(
            payload.rev,
            withFlowEnabled(payload.flows, v.flowId, v.enabled)
        );
        return {
            flowId: v.flowId,
            summary: describeFlowChange(
                v.enabled ? 'enable' : 'disable',
                flow,
                v.flowId
            )
        };
    }

    @Component.Expose('Delete')
    @Component.CheckPermissions(canManageThisNodeRed)
    async delete(params: unknown) {
        const v = validateOrThrow<AutomationDeleteParams>(
            params,
            AUTOMATION_DELETE_PARAMS_SCHEMA
        );
        const {payload, flow} = await this.#readFlow(v.flowId);
        await deployGraph(
            payload.rev,
            deleteFlowGraph(payload.flows, v.flowId)
        );
        return {
            flowId: v.flowId,
            summary: describeFlowChange('delete', flow, v.flowId)
        };
    }

    // Every change names the automation first, so a typo is refused instead of
    // doing nothing quietly, and the summary can say which one was touched.
    async #readFlow(flowId: string) {
        assertNodeRedPresent();
        const payload = await fetchNodeRedFlows();
        const flow = findFlow(summarizeFlowSet(payload), flowId);
        if (!flow) throw new Error(`no automation with id ${flowId}`);
        return {payload, flow};
    }

    protected override getDefaultConfig() {
        return {};
    }
}
