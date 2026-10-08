// Automations, as Fleet Manager methods.
//
// Node-RED is an HTTP app behind a proxy, so it was in no RPC catalog. Nobody
// outside a browser could see, make or stop an automation, and an automation
// runs unattended on real hardware.
//
// This namespace is the umbrella, not "the Node-RED API". Every automation
// carries an `engine`, and Node-RED is the first. A built-in engine is planned
// and slots in here rather than taking a namespace of its own.
//
// That choice follows the convention every large API arrived at: one resource
// with an engine FIELD when only the payload differs, a namespace per engine
// only when the VERBS differ. Ours do not — list, get, create, update, enable,
// delete read the same for any engine, and "list all my automations" is a
// well-formed request across all of them. RDS, Stripe, Grafana, Vault mounts
// and the Kubernetes class resources all landed here. The migrations found all
// ran the same direction: AWS renamed 21 engine-named OpenSearch operations to
// engine-agnostic ones, and every customer had to rewrite their IAM policies
// permanently. Azure Logic Apps split two variants of one product across two
// resource providers and can no longer list them in one call.
//
// Recipe methods build the wiring and check the action against the generated
// catalog. Graph methods expose raw Node-RED authoring separately, with
// structural, installed-node and revision validation. Get says
// `editable:false` when the recipe methods cannot safely rewrite a hand-built
// flow; Graph.Update can still replace its complete graph explicitly.

import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';

// Node-RED assigns flow ids; it is the validator of their format.
const FLOW_ID: JsonSchema = {type: 'string', minLength: 1, maxLength: 128};

export type AutomationFlowRecord = Record<string, unknown>;

export interface AutomationSubflowGraph {
    id: string;
    properties: AutomationFlowRecord;
    nodes: AutomationFlowRecord[];
    configs: AutomationFlowRecord[];
}

export interface AutomationFlowGraph {
    properties: AutomationFlowRecord;
    nodes: AutomationFlowRecord[];
    configs: AutomationFlowRecord[];
    subflows: AutomationSubflowGraph[];
}

export type AutomationGraphPageItem =
    | {kind: 'properties'; value: AutomationFlowRecord}
    | {kind: 'node'; value: AutomationFlowRecord}
    | {kind: 'config'; value: AutomationFlowRecord}
    | {
          kind: 'subflow';
          subflowId: string;
          value: AutomationFlowRecord;
      }
    | {
          kind: 'subflow_node';
          subflowId: string;
          value: AutomationFlowRecord;
      }
    | {
          kind: 'subflow_config';
          subflowId: string;
          value: AutomationFlowRecord;
      };
const FLOW_REVISION: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 256,
    description:
        'Node-RED whole-graph revision. Update and delete reject a stale value instead of overwriting another editor.'
};

const FLOW_RECORD_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true,
    required: ['id', 'type'],
    properties: {
        id: FLOW_ID,
        type: {type: 'string', minLength: 1, maxLength: 256},
        z: FLOW_ID
    },
    maxBytes: 1_000_000
};

const SUBFLOW_GRAPH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'properties', 'nodes', 'configs'],
    properties: {
        id: FLOW_ID,
        properties: {type: 'object', additionalProperties: true},
        nodes: {type: 'array', items: FLOW_RECORD_SCHEMA, maxItems: 10_000},
        configs: {type: 'array', items: FLOW_RECORD_SCHEMA, maxItems: 10_000}
    }
};

const FLOW_GRAPH_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['properties', 'nodes', 'configs', 'subflows'],
    properties: {
        properties: {
            type: 'object',
            additionalProperties: true,
            description:
                'Raw tab properties except id and type. Includes label, disabled, info, env and future Node-RED properties.'
        },
        nodes: {type: 'array', items: FLOW_RECORD_SCHEMA, maxItems: 10_000},
        configs: {type: 'array', items: FLOW_RECORD_SCHEMA, maxItems: 10_000},
        subflows: {
            type: 'array',
            items: SUBFLOW_GRAPH_SCHEMA,
            maxItems: 1_000,
            description:
                'Subflow definitions. Managed only through flowId "global".'
        }
    },
    maxBytes: 5_000_000
};

/**
 * The engines that can run an automation.
 *
 * Strict grammar on purpose: lowercase, underscore-separated, no spaces and no
 * version suffix. Datadog's monitor `type` enum shows what a decade without one
 * looks like — it now holds both `event alert` and `event-v2 alert`.
 */
export const AUTOMATION_ENGINES = ['node_red'] as const;
export type AutomationEngine = (typeof AUTOMATION_ENGINES)[number];

const ENGINE_SCHEMA: JsonSchema = {
    type: 'string',
    enum: [...AUTOMATION_ENGINES],
    description:
        'Which runtime executes this automation. Today only node_red; a built-in engine is planned.'
};

// Same rule as opening the editor in a browser. Enforced by
// modules/nodeRed/access.ts, not a CRUD component, so there is one answer.
const PERM_AUTOMATION = {note: 'automation:update or Node-RED editor access'};

export interface AutomationListParams {
    /** Include automations that are switched off. Default true. */
    includeDisabled?: boolean;
    engine?: AutomationEngine;
}
export const AUTOMATION_LIST_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        includeDisabled: {type: 'boolean'},
        // Optional on purpose. Unfiltered means every engine, including ones
        // added later, which is what "what automations do I have" means.
        engine: ENGINE_SCHEMA
    }
};

const AUTOMATION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'engine',
        'label',
        'disabled',
        'nodeCount',
        'usesFleetManager',
        'deviceIds'
    ],
    properties: {
        id: FLOW_ID,
        engine: ENGINE_SCHEMA,
        label: {type: 'string'},
        disabled: {
            type: 'boolean',
            description: 'True when switched off and therefore not running.'
        },
        nodeCount: {type: 'integer'},
        usesFleetManager: {
            type: 'boolean',
            description:
                'True when the automation drives Fleet Manager devices.'
        },
        deviceIds: {
            type: 'array',
            items: {type: 'string'},
            description:
                'Devices the Fleet Manager nodes reach: named devices plus current members of the groups, places (with the places inside them) and tags they target; a whole-fleet node lists every device of the organization.'
        }
    }
};

export const AUTOMATION_LIST_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'available'],
    properties: {
        items: {type: 'array', items: AUTOMATION_SCHEMA},
        available: {
            type: 'boolean',
            description:
                'False when this install has no Node-RED. Distinct from an empty list, which means Node-RED is running with no automations in it.'
        },
        note: {type: 'string'}
    }
};

// ── The recipe ──────────────────────────────────────────────────────

const TRIGGER_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind'],
    description:
        'When it runs. One of: a cron expression, a fixed interval, or Fleet Manager events.',
    properties: {
        kind: {type: 'string', enum: ['cron', 'everySeconds', 'onEvents']},
        cron: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description: 'Five-field cron, e.g. "0 18 * * *" for 18:00 daily.'
        },
        seconds: {type: 'integer', minimum: 1, maximum: 86400},
        events: {
            type: 'array',
            items: {type: 'string', minLength: 1, maxLength: 120},
            description: 'Event names, e.g. ["device.offline", "alert.fired"].'
        }
    }
};

const TARGET_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    description:
        'Who it applies to. Combine as needed; leave all empty and nothing is targeted.',
    properties: {
        deviceIds: {type: 'array', items: {type: 'string'}},
        groupIds: {type: 'array', items: {type: 'integer'}},
        locationIds: {type: 'array', items: {type: 'integer'}},
        tagKeys: {type: 'array', items: {type: 'string'}},
        fleet: {
            type: 'boolean',
            description:
                'Every device in the organization. Never the default; say so explicitly.'
        }
    }
};

const ACTION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['method'],
    description: 'What to do. Any Fleet Manager method the caller may run.',
    properties: {
        method: {
            type: 'string',
            minLength: 1,
            maxLength: 120,
            description: 'e.g. "Light.Set". Refused if no such method exists.'
        },
        params: {type: 'object', description: 'Params for that method.'}
    }
};

const RECIPE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'when', 'who', 'what'],
    properties: {
        name: {type: 'string', minLength: 1, maxLength: 120},
        when: TRIGGER_SCHEMA,
        who: TARGET_SCHEMA,
        what: ACTION_SCHEMA
    }
};

export interface AutomationGetParams {
    flowId: string;
}
export const AUTOMATION_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId'],
    properties: {flowId: FLOW_ID}
};

export const AUTOMATION_GET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'engine', 'label', 'disabled', 'editable'],
    properties: {
        flowId: FLOW_ID,
        engine: ENGINE_SCHEMA,
        label: {type: 'string'},
        disabled: {type: 'boolean'},
        editable: {
            type: 'boolean',
            description:
                'True when the automation is a when/who/what recipe and Update can change it. False when it was built by hand in the editor; SetEnabled and Delete still work.'
        },
        recipe: RECIPE_SCHEMA,
        nodeCount: {type: 'integer'},
        usesFleetManager: {type: 'boolean'}
    }
};

export interface AutomationCreateParams {
    name: string;
    engine?: AutomationEngine;
    when: Record<string, unknown>;
    who: Record<string, unknown>;
    what: Record<string, unknown>;
}
export const AUTOMATION_CREATE_PARAMS_SCHEMA: JsonSchema = {
    ...RECIPE_SCHEMA,
    properties: {
        ...(RECIPE_SCHEMA.properties as Record<string, JsonSchema>),
        // Optional while there is one engine. Omitting it picks the only one
        // installed; naming a second engine before it exists is refused rather
        // than silently run somewhere else.
        engine: ENGINE_SCHEMA
    }
};

export interface AutomationUpdateParams {
    flowId: string;
    name?: string;
    when?: Record<string, unknown>;
    who?: Record<string, unknown>;
    what?: Record<string, unknown>;
}
export const AUTOMATION_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId'],
    description:
        'Change one part or several. Anything omitted is left exactly as it was.',
    properties: {
        flowId: FLOW_ID,
        name: {type: 'string', minLength: 1, maxLength: 120},
        when: TRIGGER_SCHEMA,
        who: TARGET_SCHEMA,
        what: ACTION_SCHEMA
    }
};

/** Takes nothing. Named so the handler validates it like every other method. */
export type AutomationListEnginesParams = Record<string, never>;
export const AUTOMATION_LIST_ENGINES_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const AUTOMATION_LIST_ENGINES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['engine', 'available', 'canCreate', 'canEdit'],
                properties: {
                    engine: ENGINE_SCHEMA,
                    label: {type: 'string'},
                    available: {
                        type: 'boolean',
                        description:
                            'False when this engine is not installed or not enabled here.'
                    },
                    canCreate: {type: 'boolean'},
                    canEdit: {
                        type: 'boolean',
                        description:
                            'Whether Update can change an automation on this engine.'
                    },
                    note: {type: 'string'}
                }
            }
        }
    }
};

export interface AutomationSetEnabledParams {
    flowId: string;
    enabled: boolean;
}
export const AUTOMATION_SET_ENABLED_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'enabled'],
    properties: {
        flowId: FLOW_ID,
        enabled: {type: 'boolean'}
    }
};

export interface AutomationDeleteParams {
    flowId: string;
}
export const AUTOMATION_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId'],
    properties: {
        flowId: FLOW_ID
    }
};

export interface AutomationGraphGetParams {
    flowId: string;
}
export const AUTOMATION_GRAPH_GET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId'],
    properties: {flowId: FLOW_ID}
};

export interface AutomationGraphReadPageParams {
    flowId: string;
    offset?: number;
    limit?: number;
    expectedRevision?: string;
}
export const AUTOMATION_GRAPH_READ_PAGE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId'],
    properties: {
        flowId: FLOW_ID,
        offset: {type: 'integer', minimum: 0},
        limit: {type: 'integer', minimum: 1, maximum: 200},
        expectedRevision: FLOW_REVISION
    }
};

export interface AutomationGraphValidateParams {
    flowId?: string;
    graph: AutomationFlowGraph;
}
export const AUTOMATION_GRAPH_VALIDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['graph'],
    properties: {
        flowId: FLOW_ID,
        graph: FLOW_GRAPH_SCHEMA
    }
};

export interface AutomationGraphCreateParams {
    graph: AutomationFlowGraph;
}
export const AUTOMATION_GRAPH_CREATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['graph'],
    properties: {graph: FLOW_GRAPH_SCHEMA}
};

export interface AutomationGraphUpdateParams {
    flowId: string;
    expectedRevision: string;
    complete: true;
    graph: AutomationFlowGraph;
}
export const AUTOMATION_GRAPH_UPDATE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'expectedRevision', 'complete', 'graph'],
    properties: {
        flowId: FLOW_ID,
        expectedRevision: FLOW_REVISION,
        complete: {
            type: 'boolean',
            const: true,
            description:
                'Caller attests that graph is complete. Do not set this when the surrounding MCP read envelope says truncated:true.'
        },
        graph: FLOW_GRAPH_SCHEMA
    }
};

export interface AutomationGraphDeleteParams {
    flowId: string;
    expectedRevision: string;
}
export const AUTOMATION_GRAPH_DELETE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'expectedRevision'],
    properties: {
        flowId: FLOW_ID,
        expectedRevision: FLOW_REVISION
    }
};

export const AUTOMATION_GRAPH_GET_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'revision', 'complete', 'graph'],
    properties: {
        flowId: FLOW_ID,
        revision: FLOW_REVISION,
        complete: {type: 'boolean', const: true},
        graph: FLOW_GRAPH_SCHEMA
    }
};

const GRAPH_PAGE_ITEM_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'value'],
    properties: {
        kind: {
            type: 'string',
            enum: [
                'properties',
                'node',
                'config',
                'subflow',
                'subflow_node',
                'subflow_config'
            ]
        },
        subflowId: FLOW_ID,
        value: {
            type: 'object',
            additionalProperties: true,
            maxBytes: 1_000_000
        }
    }
};

export const AUTOMATION_GRAPH_READ_PAGE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'revision', 'offset', 'total', 'items'],
    properties: {
        flowId: FLOW_ID,
        revision: FLOW_REVISION,
        offset: {type: 'integer', minimum: 0},
        total: {type: 'integer', minimum: 0},
        items: {type: 'array', items: GRAPH_PAGE_ITEM_SCHEMA, maxItems: 200}
    }
};

const GRAPH_ISSUE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'path', 'message'],
    properties: {
        code: {type: 'string'},
        path: {type: 'string'},
        message: {type: 'string'}
    }
};

export const AUTOMATION_GRAPH_VALIDATE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['valid', 'issues'],
    properties: {
        valid: {type: 'boolean'},
        issues: {type: 'array', items: GRAPH_ISSUE_SCHEMA},
        coverage: {
            type: 'object',
            additionalProperties: false,
            required: [
                'version',
                'definitionSource',
                'validatedNodeTypes',
                'partiallyValidatedNodeTypes',
                'unvalidatedInstalledNodeTypes',
                'uncheckedProperties',
                'evaluatesEditorJavaScript'
            ],
            properties: {
                version: {type: 'integer', enum: [1]},
                definitionSource: {
                    type: 'string',
                    enum: ['installed-node-red', 'unavailable'],
                    description:
                        'installed-node-red: properties were checked against the editor definitions the running Node-RED reports. unavailable: only built-in Fleet rules ran.'
                },
                validatedNodeTypes: {type: 'array', items: {type: 'string'}},
                partiallyValidatedNodeTypes: {
                    type: 'array',
                    items: {type: 'string'}
                },
                unvalidatedInstalledNodeTypes: {
                    type: 'array',
                    items: {type: 'string'}
                },
                uncheckedProperties: {
                    type: 'array',
                    description:
                        'Properties whose editor validator Fleet cannot run: custom functions and message, context or JSONata typed values.',
                    items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['type', 'properties'],
                        properties: {
                            type: {type: 'string'},
                            properties: {
                                type: 'array',
                                items: {type: 'string'}
                            }
                        }
                    }
                },
                evaluatesEditorJavaScript: {type: 'boolean', enum: [false]}
            }
        }
    }
};

export const AUTOMATION_GRAPH_CHANGE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'revision', 'summary'],
    properties: {
        flowId: FLOW_ID,
        revision: FLOW_REVISION,
        summary: {type: 'string'}
    }
};

export const AUTOMATION_CHANGE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'summary'],
    properties: {
        flowId: FLOW_ID,
        /** The plain sentence describing what was done, for the audit trail. */
        summary: {type: 'string'}
    }
};

// ── Activity and health ─────────────────────────────────────────────

/** Node-RED node ids and types: short tokens, never free text. */
const NODE_TOKEN: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 64,
    pattern: '^[A-Za-z0-9._:-]+$'
};

export interface AutomationReportActivityParams {
    flowId: string;
    nodeId: string;
    nodeType: string;
    kind: 'run' | 'error';
    message?: string;
}
export const AUTOMATION_REPORT_ACTIVITY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['flowId', 'nodeId', 'nodeType', 'kind'],
    properties: {
        flowId: NODE_TOKEN,
        nodeId: NODE_TOKEN,
        nodeType: NODE_TOKEN,
        kind: {type: 'string', enum: ['run', 'error']},
        message: {type: 'string', maxLength: 500}
    }
};

export const AUTOMATION_REPORT_ACTIVITY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['recorded'],
    properties: {recorded: {type: 'boolean'}}
};

export interface AutomationGetActivityParams {
    flowId?: string;
}
export const AUTOMATION_GET_ACTIVITY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {flowId: FLOW_ID}
};

const ACTIVITY_ERROR_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['at', 'nodeId', 'nodeType'],
    properties: {
        at: {type: 'string', format: 'date-time'},
        nodeId: {type: 'string'},
        nodeType: {type: 'string'},
        message: {type: 'string'}
    }
};

export const AUTOMATION_GET_ACTIVITY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['flowId', 'runCount', 'errorCount', 'errors'],
                properties: {
                    flowId: {type: 'string'},
                    lastRunAt: {type: 'string', format: 'date-time'},
                    runCount: {type: 'integer', minimum: 0},
                    errorCount: {type: 'integer', minimum: 0},
                    lastErrorAt: {type: 'string', format: 'date-time'},
                    errors: {
                        type: 'array',
                        description: 'Newest first, at most 20.',
                        items: ACTIVITY_ERROR_SCHEMA
                    }
                }
            }
        }
    }
};

export type AutomationGetStatusParams = Record<string, never>;
export const AUTOMATION_GET_STATUS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

export const AUTOMATION_GET_STATUS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['enabled', 'reachable', 'checkedAt'],
    properties: {
        enabled: {
            type: 'boolean',
            description: 'False when this install has no Node-RED.'
        },
        reachable: {
            type: 'boolean',
            description: 'Whether Node-RED answered the last health probe.'
        },
        orgId: {
            type: 'string',
            description: 'The one organization this Node-RED belongs to.'
        },
        flowCount: {type: 'integer', minimum: 0},
        checkedAt: {type: 'string', format: 'date-time'}
    }
};

// ── Describe ────────────────────────────────────────────────────────

const b = new DescribeBuilder('automation', {
    kind: 'fleet-manager',
    description:
        'See and control the Node-RED automations running on this Fleet Manager.'
});

b.registerMethod('List', {
    params: AUTOMATION_LIST_PARAMS_SCHEMA,
    response: AUTOMATION_LIST_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'List the Node-RED automations: name, whether each is switched on, size, and whether it drives Fleet Manager devices. Says plainly when this install has no Node-RED, which is not the same as having no automations.'
});

b.registerMethod('ListEngines', {
    params: AUTOMATION_LIST_ENGINES_PARAMS_SCHEMA,
    response: AUTOMATION_LIST_ENGINES_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Which automation engines this install has, and what each one can do. Ask here before Create rather than discovering by being refused: an engine can be absent entirely, or present but unable to edit an automation someone built by hand.'
});

b.registerMethod('Get', {
    params: AUTOMATION_GET_PARAMS_SCHEMA,
    response: AUTOMATION_GET_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Read one automation as when/who/what. Returns editable:false for a flow built by hand in the editor, which Update cannot safely change.'
});

b.registerMethod('Graph.Get', {
    params: AUTOMATION_GRAPH_GET_PARAMS_SCHEMA,
    response: AUTOMATION_GRAPH_GET_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Read the complete raw graph for one Node-RED tab. Use flowId "global" to read global configuration nodes and subflow definitions. Large MCP results can be truncated; use Graph.ReadPage for a bounded revision-consistent read. The returned revision is required by Graph.Update and Graph.Delete.'
});

b.registerMethod('Graph.ReadPage', {
    params: AUTOMATION_GRAPH_READ_PAGE_PARAMS_SCHEMA,
    response: AUTOMATION_GRAPH_READ_PAGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Read a bounded page of raw graph entries. Page zero returns the whole-graph revision; every later page requires that value as expectedRevision and rejects concurrent edits. Continue while offset + the number of items actually returned is less than total, or use the fm_read cursor when its envelope is truncated. Reassemble entries by kind before sending the complete graph to Graph.Update.'
});

b.registerMethod('Graph.Validate', {
    params: AUTOMATION_GRAPH_VALIDATE_PARAMS_SCHEMA,
    response: AUTOMATION_GRAPH_VALIDATE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Check graph structure, identifiers, wiring, configuration references and installed node types. Node properties of every installed type, third-party included, are checked against the editor definitions the running Node-RED reports (required, number, pattern, typed JSON/number values, config references, output counts), plus Fleet rules for its own nodes. Coverage names the definition source, partially checked and unvalidated types and each property whose custom validator could not run. Fleet never evaluates editor JavaScript.'
});

b.registerMethod('Graph.Create', {
    params: AUTOMATION_GRAPH_CREATE_PARAMS_SCHEMA,
    response: AUTOMATION_GRAPH_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'create'},
    description:
        'Create a complete Node-RED flow graph. Node and config ids must be unique. Set properties.disabled:true to create a draft that does not run. A concurrent deployment is rejected and is never retried silently.'
});

b.registerMethod('Graph.Update', {
    params: AUTOMATION_GRAPH_UPDATE_PARAMS_SCHEMA,
    response: AUTOMATION_GRAPH_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'update'},
    description:
        'Replace one complete Node-RED flow graph while preserving every unrelated flow record. Requires complete:true and the revision returned by an untruncated Graph.Get or fully reassembled Graph.ReadPage sequence, and atomically rejects stale revisions. Redacted values keep their stored value. Use flowId "global" to update global config nodes and subflows.'
});

b.registerMethod('Graph.Delete', {
    params: AUTOMATION_GRAPH_DELETE_PARAMS_SCHEMA,
    response: AUTOMATION_GRAPH_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'delete', destructive: true},
    description:
        'Delete one Node-RED tab and its nodes. Requires the revision returned by Graph.Get and atomically rejects stale revisions. The global graph cannot be deleted.'
});

b.registerMethod('Create', {
    params: AUTOMATION_CREATE_PARAMS_SCHEMA,
    response: AUTOMATION_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    // A new automation starts running as soon as it deploys, so a human sees
    // it first. Not idempotent: calling twice makes two automations.
    safety: {operation: 'create'},
    description:
        'Create an automation from a recipe: WHEN (cron, interval or events), WHO (devices, groups, locations, tags or the fleet), WHAT (a Fleet Manager method and its params). It starts running once deployed.'
});

b.registerMethod('Update', {
    params: AUTOMATION_UPDATE_PARAMS_SCHEMA,
    response: AUTOMATION_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'update'},
    description:
        'Change an existing automation: rename it, retarget it, retime it, or change what it does. Omitted parts stay as they were. Refused when the automation is not a recipe, because rewriting a hand-built flow would discard it.'
});

b.registerMethod('SetEnabled', {
    params: AUTOMATION_SET_ENABLED_PARAMS_SCHEMA,
    response: AUTOMATION_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    // Not destructive: it can be switched back on. Stopping a misbehaving
    // automation fast is the point.
    safety: {operation: 'update', idempotent: true},
    description:
        'Switch one automation on or off. Off stops it running and keeps it, so a misbehaving automation can be stopped without losing the work in it.'
});

b.registerMethod('Delete', {
    params: AUTOMATION_DELETE_PARAMS_SCHEMA,
    response: AUTOMATION_CHANGE_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    // Fleet Manager holds no copy, so this always asks a human first.
    safety: {operation: 'delete', destructive: true},
    description:
        'Delete an automation and every node in it. Fleet Manager keeps no copy and cannot undo this. Prefer SetEnabled with enabled:false unless the automation is genuinely finished with.'
});

b.registerMethod('ReportActivity', {
    params: AUTOMATION_REPORT_ACTIVITY_PARAMS_SCHEMA,
    response: AUTOMATION_REPORT_ACTIVITY_RESPONSE_SCHEMA,
    permission: {note: 'Node-RED service account only'},
    safety: {operation: 'update'},
    description:
        'Called by the Fleet Manager Node-RED nodes, not by people: records that a node in a flow ran or failed. Kept in memory for the activity view; a restart starts empty.'
});

b.registerMethod('GetActivity', {
    params: AUTOMATION_GET_ACTIVITY_PARAMS_SCHEMA,
    response: AUTOMATION_GET_ACTIVITY_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Last run time, run count and the 20 most recent errors for each Node-RED flow, or for one flow. Only flows whose nodes reported since the last restart appear.'
});

b.registerMethod('GetStatus', {
    params: AUTOMATION_GET_STATUS_PARAMS_SCHEMA,
    response: AUTOMATION_GET_STATUS_RESPONSE_SCHEMA,
    permission: PERM_AUTOMATION,
    safety: {operation: 'read', idempotent: true},
    description:
        'Whether Node-RED is enabled and answering, which organization it belongs to, and how many flows it runs. The answer is cached for a few seconds.'
});

export const AUTOMATION_DESCRIBE: DescribeOutput = b.build();
