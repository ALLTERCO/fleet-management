import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {EFFECTIVE_SHAPE_SCHEMA, type EffectiveShape} from './authz';
import {AUTHZ_SYSTEM_PERSONA_KEYS, type FleetRole} from './authzCatalog';
import {type OrganizationProfile, PROFILE_SCHEMA} from './organization';

export interface EntityCapabilityDescribe {
    shellyComponent: string | null;
    actions: {action: string; rpc: string}[];
}

export interface SystemBootstrapUserSummary {
    username: string | null;
    // Sorted by catalog priority. roles[0] is the priority pick.
    roles: readonly FleetRole[];
    group: string;
    canWrite: boolean;
    isAdmin: boolean;
    isViewer: boolean;
    // Null for admin / trusted callers — no scoping applies.
    effectiveShape: EffectiveShape | null;
}

export interface SystemBootstrapRuntimeSummary {
    backendVersion: string;
    apiContractVersion: string;
    authMode: 'dev' | 'zitadel';
    deploymentMode: 'oss' | 'shared_saas' | 'dedicated_saas';
    safeMode: boolean;
    frontendArtifact: {
        id: string;
        version: string;
        uiContractVersion: string;
    };
    addons: {
        grafana: boolean;
        nodeRed: boolean;
    };
}

export interface SystemBootstrapResponse {
    version: 1;
    organization: OrganizationProfile | null;
    user: SystemBootstrapUserSummary;
    runtime: SystemBootstrapRuntimeSummary;
    features: {
        components: Record<string, boolean>;
    };
}

export interface SystemDescribeOutput extends DescribeOutput {
    components: Record<string, unknown>;
    entityCapabilities: Record<string, EntityCapabilityDescribe>;
}

const EMPTY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {}
};

const NULL_RESPONSE: JsonSchema = {type: 'null'};

// Reuse the single org-profile schema so the Bootstrap payload can't drift from
// organization.GetProfile when new profile fields are added.
const ORGANIZATION_PROFILE_SCHEMA: JsonSchema = PROFILE_SCHEMA;

const ENTITY_CAPABILITY_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['shellyComponent', 'actions'],
    properties: {
        shellyComponent: {type: ['string', 'null']},
        actions: {
            type: 'array',
            items: {
                type: 'object',
                required: ['action', 'rpc'],
                properties: {
                    action: {type: 'string'},
                    rpc: {type: 'string'}
                }
            }
        }
    }
};

export const SYSTEM_BOOTSTRAP_PARAMS_SCHEMA = EMPTY_PARAMS;

export const SYSTEM_BOOTSTRAP_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['version', 'organization', 'user', 'runtime', 'features'],
    properties: {
        version: {type: 'integer', const: 1},
        organization: {
            anyOf: [ORGANIZATION_PROFILE_SCHEMA, {type: 'null'}]
        },
        user: {
            type: 'object',
            required: [
                'username',
                'roles',
                'group',
                'canWrite',
                'isAdmin',
                'isViewer',
                'effectiveShape'
            ],
            properties: {
                username: {type: ['string', 'null']},
                roles: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: [...AUTHZ_SYSTEM_PERSONA_KEYS, 'none']
                    }
                },
                group: {type: 'string'},
                canWrite: {type: 'boolean'},
                isAdmin: {type: 'boolean'},
                isViewer: {type: 'boolean'},
                effectiveShape: {
                    anyOf: [EFFECTIVE_SHAPE_SCHEMA, {type: 'null'}]
                }
            }
        },
        runtime: {
            type: 'object',
            required: [
                'backendVersion',
                'apiContractVersion',
                'authMode',
                'deploymentMode',
                'safeMode',
                'frontendArtifact',
                'addons'
            ],
            properties: {
                backendVersion: {type: 'string'},
                apiContractVersion: {type: 'string'},
                authMode: {type: 'string', enum: ['dev', 'zitadel']},
                deploymentMode: {
                    type: 'string',
                    enum: ['oss', 'shared_saas', 'dedicated_saas']
                },
                safeMode: {type: 'boolean'},
                frontendArtifact: {
                    type: 'object',
                    required: ['id', 'version', 'uiContractVersion'],
                    properties: {
                        id: {type: 'string'},
                        version: {type: 'string'},
                        uiContractVersion: {type: 'string'}
                    }
                },
                addons: {
                    type: 'object',
                    required: ['grafana', 'nodeRed'],
                    properties: {
                        grafana: {type: 'boolean'},
                        nodeRed: {type: 'boolean'}
                    }
                }
            }
        },
        features: {
            type: 'object',
            required: ['components'],
            properties: {
                components: {
                    type: 'object',
                    additionalProperties: {type: 'boolean'}
                }
            }
        }
    }
};

const SYSTEM_DESCRIBE_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['namespace', 'methods', 'components', 'entityCapabilities'],
    properties: {
        namespace: {type: 'string', const: 'system'},
        methods: {type: 'object', additionalProperties: true},
        components: {type: 'object', additionalProperties: true},
        entityCapabilities: {
            type: 'object',
            additionalProperties: ENTITY_CAPABILITY_SCHEMA
        },
        limits: {type: 'object', additionalProperties: true},
        tags: {type: 'array', items: {type: 'string'}},
        errors: {type: 'array'}
    }
};

export const SYSTEM_SUBMIT_TELEMETRY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        counts: {type: 'object', additionalProperties: {type: 'number'}},
        clicks: {type: 'integer', minimum: 1},
        // Frontend WS-patch telemetry (B1-B3) for the perf-bottleneck
        // diagnostic loop. Snapshot-then-reset on the client; the server
        // converts to Prom gauges/counters.
        wsTelemetry: {
            type: 'object',
            additionalProperties: false,
            properties: {
                patchBufferMaxDepth: {type: 'integer', minimum: 0},
                droppedFrameCount: {type: 'integer', minimum: 0},
                rafFrameTimeMaxMs: {type: 'number', minimum: 0}
            }
        }
    }
};

export interface SystemSubscribeParams {
    events: string[];
    options?: Record<string, unknown>;
    /** Cross-reconnect stream resume: persistent session id supplied by the FE. */
    connectionId?: string;
    /** Last successfully-received stream entry id (e.g. "1684123456789-0"). */
    lastSeenStreamId?: string;
}
export const SYSTEM_SUBSCRIBE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['events'],
    additionalProperties: false,
    properties: {
        events: {type: 'array', items: {type: 'string'}},
        options: {type: 'object', additionalProperties: true},
        connectionId: {type: 'string'},
        lastSeenStreamId: {type: 'string'}
    }
};

export interface SystemUnsubscribeParams {
    ids: number[];
}
export const SYSTEM_UNSUBSCRIBE_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['ids'],
    additionalProperties: false,
    properties: {
        ids: {type: 'array', items: {type: 'integer'}}
    }
};

export const SYSTEM_HEALTH_FULL_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['online', 'version', 'obsLevel', 'authz'],
    additionalProperties: true,
    properties: {
        online: {type: 'boolean'},
        version: {type: 'string'},
        obsLevel: {type: 'integer'},
        authz: {type: 'object', additionalProperties: true},
        commit: {type: 'string'},
        metrics: {type: 'object', additionalProperties: true}
    }
};

export const SYSTEM_GENERIC_OBJECT_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: true
};

export const SYSTEM_GET_TOPOLOGY_DIFF_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        windowMin: {type: 'integer', minimum: 1, maximum: 60}
    }
};

export const SYSTEM_TOPOLOGY_DIFF_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'schemaVersion',
        'windowMin',
        'changedEdges',
        'changedNodes',
        'nodeMembershipChanges',
        'edgeMembershipChanges'
    ],
    additionalProperties: false,
    properties: {
        schemaVersion: {type: 'integer'},
        windowMin: {type: 'integer'},
        changedEdges: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'previousThroughput',
                    'currentThroughput',
                    'pctChange'
                ],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    previousThroughput: {type: 'number'},
                    currentThroughput: {type: 'number'},
                    pctChange: {type: 'number'}
                }
            }
        },
        changedNodes: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'statusBefore', 'statusAfter'],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    statusBefore: {type: 'string'},
                    statusAfter: {type: 'string'}
                }
            }
        },
        nodeMembershipChanges: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'change', 'status'],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    change: {type: 'string'},
                    status: {type: 'string'}
                }
            }
        },
        edgeMembershipChanges: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'change', 'from', 'to'],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    change: {type: 'string'},
                    from: {type: 'string'},
                    to: {type: 'string'}
                }
            }
        }
    }
};

export const SYSTEM_GET_CONNECTION_INSPECTOR_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['connectionId'],
    additionalProperties: false,
    properties: {
        connectionId: {type: 'string', minLength: 1}
    }
};

export const SYSTEM_CONNECTION_INSPECTOR_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'connectionId',
        'user',
        'organizationId',
        'connectedAt',
        'ageSec',
        'recentEvents'
    ],
    additionalProperties: false,
    properties: {
        connectionId: {type: 'string'},
        user: {type: ['string', 'null']},
        organizationId: {type: ['string', 'null']},
        connectedAt: {type: 'integer'},
        ageSec: {type: 'integer'},
        recentEvents: {
            type: 'array',
            items: {
                type: 'object',
                required: ['kind', 'method', 'ts', 'ms'],
                additionalProperties: false,
                properties: {
                    kind: {type: 'string', enum: ['rpc', 'event', 'patch']},
                    method: {type: 'string'},
                    ts: {type: 'integer'},
                    ms: {type: ['number', 'null']}
                }
            }
        }
    }
};

export const SYSTEM_LIST_CONNECTIONS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['connections'],
    additionalProperties: false,
    properties: {
        connections: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'connectionId',
                    'user',
                    'organizationId',
                    'connectedAt',
                    'ageSec'
                ],
                additionalProperties: false,
                properties: {
                    connectionId: {type: 'string'},
                    user: {type: ['string', 'null']},
                    organizationId: {type: ['string', 'null']},
                    connectedAt: {type: 'integer'},
                    ageSec: {type: 'integer'}
                }
            }
        }
    }
};

export const SYSTEM_GET_MODULE_HISTORY_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
        name: {type: 'string', minLength: 1},
        windowSec: {type: 'integer', minimum: 1}
    }
};

export const SYSTEM_MODULE_HISTORY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['samples'],
    additionalProperties: false,
    properties: {
        samples: {
            type: 'array',
            items: {
                type: 'object',
                required: ['ts', 'stats'],
                additionalProperties: false,
                properties: {
                    ts: {type: 'integer'},
                    stats: {type: 'object', additionalProperties: true}
                }
            }
        }
    }
};

export const SYSTEM_GET_SLOW_RPCS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        windowSec: {type: 'integer', minimum: 1},
        limit: {type: 'integer', minimum: 1, maximum: 500}
    }
};

export const SYSTEM_SLOW_RPCS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entries'],
    additionalProperties: false,
    properties: {
        entries: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'method',
                    'ms',
                    'ts',
                    'sender',
                    'senderType',
                    'organizationId',
                    'p95Ms'
                ],
                additionalProperties: false,
                properties: {
                    method: {type: 'string'},
                    ms: {type: 'number'},
                    ts: {type: 'integer'},
                    sender: {type: ['string', 'null']},
                    senderType: {
                        type: 'string',
                        enum: ['user', 'service_user', 'system']
                    },
                    organizationId: {type: ['string', 'null']},
                    p95Ms: {type: 'number'}
                }
            }
        }
    }
};

export const SYSTEM_GET_SLOW_BUILDS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        windowSec: {type: 'integer', minimum: 1},
        limit: {type: 'integer', minimum: 1, maximum: 500}
    }
};

export const SYSTEM_SLOW_BUILDS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entries'],
    additionalProperties: false,
    properties: {
        entries: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'shellyID',
                    'totalMs',
                    'componentPages',
                    'stages',
                    'ts'
                ],
                additionalProperties: false,
                properties: {
                    shellyID: {type: 'string'},
                    totalMs: {type: 'integer'},
                    componentPages: {type: 'integer'},
                    ts: {type: 'integer'},
                    stages: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['name', 'ms'],
                            additionalProperties: false,
                            properties: {
                                name: {type: 'string'},
                                ms: {type: 'integer'}
                            }
                        }
                    }
                }
            }
        }
    }
};

export const SYSTEM_GET_SLOW_DEVICE_COMMANDS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        windowSec: {type: 'integer', minimum: 1},
        limit: {type: 'integer', minimum: 1, maximum: 500}
    }
};

export const SYSTEM_SLOW_DEVICE_COMMANDS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entries'],
    additionalProperties: false,
    properties: {
        entries: {
            type: 'array',
            items: {
                type: 'object',
                required: ['label', 'method', 'ms', 'outcome', 'ts'],
                additionalProperties: false,
                properties: {
                    label: {type: 'string'},
                    method: {type: 'string'},
                    ms: {type: 'integer'},
                    outcome: {
                        type: 'string',
                        enum: ['ok', 'error', 'timeout', 'unsupported']
                    },
                    ts: {type: 'integer'}
                }
            }
        }
    }
};

export const SYSTEM_GET_SLOW_CLIENTS_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        windowSec: {type: 'integer', minimum: 1},
        limit: {type: 'integer', minimum: 1, maximum: 500}
    }
};

export const SYSTEM_SLOW_CLIENTS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['entries'],
    additionalProperties: false,
    properties: {
        entries: {
            type: 'array',
            items: {
                type: 'object',
                required: ['clientId', 'bufferedBytes', 'action', 'ts'],
                additionalProperties: false,
                properties: {
                    clientId: {type: 'string'},
                    bufferedBytes: {type: 'integer'},
                    action: {type: 'string', enum: ['paused', 'dropped']},
                    ts: {type: 'integer'}
                }
            }
        }
    }
};

export const SYSTEM_TOPOLOGY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: [
        'schemaVersion',
        'generatedAt',
        'zones',
        'nodes',
        'edges',
        'flows',
        'clusters',
        'thresholds'
    ],
    additionalProperties: false,
    properties: {
        schemaVersion: {type: 'integer'},
        generatedAt: {type: 'integer'},
        thresholds: {
            type: 'object',
            additionalProperties: {
                type: 'object',
                required: ['warn', 'crit'],
                additionalProperties: false,
                properties: {
                    warn: {type: 'number'},
                    crit: {type: 'number'}
                }
            }
        },
        nodes: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'label',
                    'role',
                    'cluster',
                    'zone',
                    'kind',
                    'status',
                    'stats',
                    'route',
                    'description',
                    'virtual',
                    'noisy',
                    'order',
                    'owner',
                    'criticality',
                    'stale',
                    'participatesIn',
                    'dataClasses',
                    'externalSystem',
                    'collapseByDefault'
                ],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    label: {type: 'string'},
                    role: {type: 'string'},
                    cluster: {type: ['string', 'null']},
                    zone: {type: 'string'},
                    kind: {type: 'string'},
                    status: {type: 'string'},
                    stats: {type: 'object', additionalProperties: true},
                    route: {type: ['string', 'null']},
                    description: {type: ['string', 'null']},
                    virtual: {type: 'boolean'},
                    noisy: {type: 'boolean'},
                    order: {type: 'integer'},
                    owner: {type: ['string', 'null']},
                    criticality: {type: 'string'},
                    stale: {type: 'boolean'},
                    participatesIn: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                    dataClasses: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                    externalSystem: {type: ['string', 'null']},
                    collapseByDefault: {type: 'boolean'}
                }
            }
        },
        edges: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'from',
                    'to',
                    'direction',
                    'kind',
                    'throughput',
                    'counterName',
                    'latencyMetric',
                    'errorMetric',
                    'throughputMetric',
                    'status',
                    'criticality',
                    'declared',
                    'observed',
                    'stale',
                    'lastSeenAt',
                    'description',
                    'participatesIn'
                ],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    from: {type: 'string'},
                    to: {type: 'string'},
                    direction: {type: 'string'},
                    kind: {type: 'string'},
                    throughput: {type: 'number'},
                    counterName: {type: ['string', 'null']},
                    latencyMetric: {type: ['string', 'null']},
                    errorMetric: {type: ['string', 'null']},
                    throughputMetric: {type: ['string', 'null']},
                    status: {type: 'string'},
                    criticality: {type: 'string'},
                    declared: {type: 'boolean'},
                    observed: {type: 'boolean'},
                    stale: {type: 'boolean'},
                    lastSeenAt: {type: ['integer', 'null']},
                    description: {type: ['string', 'null']},
                    participatesIn: {
                        type: 'array',
                        items: {type: 'string'}
                    }
                }
            }
        },
        zones: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'label',
                    'description',
                    'order',
                    'collapseByDefault'
                ],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    label: {type: 'string'},
                    description: {type: 'string'},
                    order: {type: 'integer'},
                    collapseByDefault: {type: 'boolean'}
                }
            }
        },
        flows: {
            type: 'array',
            items: {
                type: 'object',
                required: [
                    'id',
                    'label',
                    'description',
                    'category',
                    'orderedNodeIds',
                    'expectedEdgeIds'
                ],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    label: {type: 'string'},
                    description: {type: 'string'},
                    category: {type: 'string'},
                    orderedNodeIds: {
                        type: 'array',
                        items: {type: 'string'}
                    },
                    expectedEdgeIds: {
                        type: 'array',
                        items: {type: 'string'}
                    }
                }
            }
        },
        clusters: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id', 'label'],
                additionalProperties: false,
                properties: {
                    id: {type: 'string'},
                    label: {type: 'string'}
                }
            }
        }
    }
};

export const SYSTEM_DB_WRITES_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['disabled'],
    additionalProperties: false,
    properties: {disabled: {type: 'boolean'}}
};

export const SYSTEM_DB_WRITES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['dbWritesDisabled'],
    additionalProperties: false,
    properties: {dbWritesDisabled: {type: 'boolean'}}
};

export const SYSTEM_OBSERVABILITY_SET_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        level: {type: 'integer', minimum: 0, maximum: 3},
        enabled: {type: 'boolean'}
    }
};

export const SYSTEM_OBSERVABILITY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['observability', 'level'],
    additionalProperties: false,
    properties: {
        observability: {type: 'boolean'},
        level: {type: 'integer', minimum: 0, maximum: 3}
    }
};

export const SYSTEM_LOG_SET_LEVEL_PARAMS_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['category', 'level'],
    additionalProperties: false,
    properties: {
        category: {type: 'string', minLength: 1},
        level: {type: 'string', minLength: 1}
    }
};

export const SYSTEM_LOG_LEVELS_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['levels'],
    additionalProperties: false,
    properties: {
        levels: {
            type: 'object',
            additionalProperties: {type: 'string'}
        }
    }
};

export const SYSTEM_LOG_SET_LEVEL_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['category', 'level'],
    additionalProperties: false,
    properties: {
        category: {type: 'string'},
        level: {type: 'string'}
    }
};

export const SYSTEM_GET_VARIABLES_PARAMS_SCHEMA = EMPTY_PARAMS;

export const SYSTEM_GET_VARIABLES_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    required: ['login-strategy', 'dev-mode'],
    additionalProperties: false,
    properties: {
        'login-strategy': {
            type: 'string',
            enum: ['local', 'zitadel-introspection']
        },
        'dev-mode': {type: 'boolean'}
    }
};

export const SYSTEM_DESCRIBE: DescribeOutput = new DescribeBuilder('system', {
    kind: 'fleet-manager',
    description:
        'Fleet-manager runtime: bootstrap, subscriptions, health, and observability.'
})
    .registerMethod('GetVariables', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_VARIABLES_PARAMS_SCHEMA,
        response: SYSTEM_GET_VARIABLES_RESPONSE_SCHEMA,
        permission: {note: 'public compatibility'},
        description:
            'Compatibility runtime variables for clients that have not moved to System.Bootstrap.'
    })
    .registerMethod('SubmitTelemetry', {
        safety: {operation: 'read'},
        params: SYSTEM_SUBMIT_TELEMETRY_PARAMS_SCHEMA,
        response: NULL_RESPONSE,
        permission: {note: 'authenticated'},
        description: 'Submit frontend interaction counters for observability.'
    })
    .registerMethod('Subscribe', {
        safety: {operation: 'read'},
        params: SYSTEM_SUBSCRIBE_PARAMS_SCHEMA,
        response: {
            type: 'object',
            required: ['ids'],
            properties: {
                ids: {type: 'array', items: {type: 'integer'}}
            }
        },
        permission: {note: 'authenticated'},
        description:
            'Subscribe the current websocket to runtime events. Per-event ' +
            'options.events[name] may include a paths: string[] of dot-path ' +
            'declarations (e.g. ["switch:0.output","sys.unixtime"]). When ' +
            'paths is present the server only fires when one of those ' +
            'fields actually changed, and only those fields are sent. ' +
            'Omit paths to receive today’s full payload (back-compat).'
    })
    .registerMethod('Unsubscribe', {
        safety: {operation: 'read'},
        params: SYSTEM_UNSUBSCRIBE_PARAMS_SCHEMA,
        response: NULL_RESPONSE,
        permission: {note: 'authenticated'},
        description: 'Remove websocket event subscriptions by id.'
    })
    .registerMethod('Bootstrap', {
        safety: {operation: 'read'},
        params: SYSTEM_BOOTSTRAP_PARAMS_SCHEMA,
        response: SYSTEM_BOOTSTRAP_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Return backend-owned runtime facts for frontend startup.'
    })
    .registerMethod('Describe', {
        params: EMPTY_PARAMS,
        response: SYSTEM_DESCRIBE_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description:
            'Return aggregate runtime contract discovery across public namespaces.'
    })
    .registerMethod('Health.GetFull', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_HEALTH_FULL_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description: 'Return rich instance health and authz runtime status.'
    })
    .registerMethod('Health.GetDebugReport', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_GENERIC_OBJECT_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Return the current in-memory debug report.'
    })
    .registerMethod('Health.GetStreams', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_GENERIC_OBJECT_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Return Redis stream and ingest overflow health.'
    })
    .registerMethod('Health.GetHistory', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_GENERIC_OBJECT_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Return recent in-memory runtime metric history.'
    })
    .registerMethod('GetTopology', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_TOPOLOGY_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return the auto-derived module topology for the monitoring diagram.'
    })
    .registerMethod('GetSlowRpcs', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_SLOW_RPCS_PARAMS_SCHEMA,
        response: SYSTEM_SLOW_RPCS_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return slow RPC calls (above P95 + 100ms) in the requested time window.'
    })
    .registerMethod('GetSlowBuilds', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_SLOW_BUILDS_PARAMS_SCHEMA,
        response: SYSTEM_SLOW_BUILDS_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return slow device builds (probe + compose) with their per-stage breakdown in the requested window.'
    })
    .registerMethod('GetSlowDeviceCommands', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_SLOW_DEVICE_COMMANDS_PARAMS_SCHEMA,
        response: SYSTEM_SLOW_DEVICE_COMMANDS_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return slow device commands (FM→device RPCs) with method and round-trip ms in the requested window.'
    })
    .registerMethod('GetSlowClients', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_SLOW_CLIENTS_PARAMS_SCHEMA,
        response: SYSTEM_SLOW_CLIENTS_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return browser WS clients that hit send backpressure (paused or dropped) in the requested window.'
    })
    .registerMethod('GetModuleHistory', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_MODULE_HISTORY_PARAMS_SCHEMA,
        response: SYSTEM_MODULE_HISTORY_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return per-module stats samples within the requested time window.'
    })
    .registerMethod('ListConnections', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_LIST_CONNECTIONS_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description: 'Return active WebSocket connection summaries.'
    })
    .registerMethod('GetConnectionInspector', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_CONNECTION_INSPECTOR_PARAMS_SCHEMA,
        response: SYSTEM_CONNECTION_INSPECTOR_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return recent events and metadata for a single WebSocket connection.'
    })
    .registerMethod('GetTopologyDiff', {
        safety: {operation: 'read'},
        params: SYSTEM_GET_TOPOLOGY_DIFF_PARAMS_SCHEMA,
        response: SYSTEM_TOPOLOGY_DIFF_RESPONSE_SCHEMA,
        permission: {note: 'admin-only'},
        description:
            'Return notable edge throughput + node status changes over the requested window.'
    })
    .registerMethod('DbWrites.Get', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_DB_WRITES_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Return whether diagnostic DB writes are disabled.'
    })
    .registerMethod('DbWrites.Set', {
        safety: {operation: 'update'},
        params: SYSTEM_DB_WRITES_SET_PARAMS_SCHEMA,
        response: SYSTEM_DB_WRITES_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description: 'Set the instance-wide diagnostic DB write toggle.'
    })
    .registerMethod('Observability.Set', {
        safety: {operation: 'update'},
        params: SYSTEM_OBSERVABILITY_SET_PARAMS_SCHEMA,
        response: SYSTEM_OBSERVABILITY_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description: 'Set runtime observability level.'
    })
    .registerMethod('Observability.Reset', {
        safety: {operation: 'update'},
        params: EMPTY_PARAMS,
        response: {
            type: 'object',
            required: ['reset'],
            additionalProperties: false,
            properties: {reset: {type: 'boolean'}}
        },
        permission: {note: 'provider-support-only'},
        description: 'Reset runtime observability timings and counters.'
    })
    .registerMethod('Log.ListLevels', {
        safety: {operation: 'read'},
        params: EMPTY_PARAMS,
        response: SYSTEM_LOG_LEVELS_RESPONSE_SCHEMA,
        permission: {note: 'authenticated'},
        description: 'Return runtime log levels for known categories.'
    })
    .registerMethod('Log.SetLevel', {
        safety: {operation: 'update'},
        params: SYSTEM_LOG_SET_LEVEL_PARAMS_SCHEMA,
        response: SYSTEM_LOG_SET_LEVEL_RESPONSE_SCHEMA,
        permission: {note: 'provider-support-only'},
        description: 'Set the runtime log level for one category.'
    })
    .build();
