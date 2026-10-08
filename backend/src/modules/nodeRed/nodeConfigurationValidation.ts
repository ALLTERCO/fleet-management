import type {FlowRecord} from './flowClient';
import {
    checkAgainstDefinition,
    definitionOutputs,
    type NodeRedNodeDefinition,
    type NodeRedNodeDefinitions,
    uncheckedDefinitionProperties
} from './nodeDefinitions';

export interface NodeConfigurationIssue {
    code: string;
    path: string;
    message: string;
}

interface SubflowInput {
    properties: FlowRecord;
    nodes: FlowRecord[];
    configs: FlowRecord[];
    id: string;
}

interface GraphInput {
    nodes: FlowRecord[];
    configs: FlowRecord[];
    subflows: SubflowInput[];
}

export interface NodeConfigurationValidationInput {
    graph: GraphInput;
    externalConfigs?: readonly FlowRecord[];
    // Installed editor definitions; null when Node-RED could not describe them.
    definitions?: NodeRedNodeDefinitions | null;
}

export interface NodeConfigurationValidationCoverage {
    version: 1;
    definitionSource: 'installed-node-red' | 'unavailable';
    validatedNodeTypes: string[];
    partiallyValidatedNodeTypes: string[];
    unvalidatedInstalledNodeTypes: string[];
    uncheckedProperties: Array<{type: string; properties: string[]}>;
    evaluatesEditorJavaScript: false;
}

// Everything one record is checked against inside its flow or subflow.
interface ScopeContext {
    configsById: ReadonlyMap<string, FlowRecord>;
    nodeIds: ReadonlySet<string>;
    subflowOutputs: ReadonlyMap<string, number>;
    definitions: NodeRedNodeDefinitions | null;
    registeredTypes: ReadonlySet<string>;
}

type ValueKind = 'boolean' | 'integer' | 'number' | 'object' | 'string';

interface FieldRule {
    kind: ValueKind;
    required?: boolean;
    numericString?: boolean;
    values?: readonly unknown[];
    minimum?: number;
    maximum?: number;
}

interface ReferenceRule {
    property: string;
    types: readonly string[];
    required?: boolean;
}

interface NodeRule {
    fields?: Readonly<Record<string, FieldRule>>;
    outputs?: number | ((record: FlowRecord) => number | undefined);
    references?: readonly ReferenceRule[];
}

const FLEET_OPERATION_TYPES = [
    'fm-rpc',
    'fm-tag',
    'fm-group',
    'fm-location',
    'fm-device',
    'fm-component-catalog',
    'fm-component-state',
    'fm-component-action',
    'fm-schedule',
    'fm-variable',
    'fm-webhook',
    'fm-script',
    'fm-firmware',
    'fm-backup',
    'fm-certificate',
    'fm-diagnostics',
    'fm-alert',
    'fm-report',
    'fm-energy',
    'fm-notification',
    'fm-audit'
] as const;

const SERVER_REFERENCE: ReferenceRule = {
    property: 'server',
    types: ['fm-server'],
    required: true
};

// Which devices an event or trigger node listens to.
const DEVICE_SCOPE_FIELDS: Readonly<Record<string, FieldRule>> = {
    scopeType: {
        kind: 'string',
        values: ['all', 'devices', 'group', 'location']
    },
    deviceIds: {kind: 'string'},
    groupId: {kind: 'string'},
    locationId: {kind: 'string'},
    refreshMinutes: {kind: 'integer', numericString: true, minimum: 1}
};

const CONFIG_RULES: Readonly<Record<string, NodeRule>> = {
    'fm-server': {
        fields: {
            name: {kind: 'string'},
            baseUrl: {kind: 'string'},
            wsUrl: {kind: 'string'}
        }
    },
    'mqtt-broker': {
        fields: {
            broker: {kind: 'string', required: true},
            port: {
                kind: 'integer',
                numericString: true,
                minimum: 1,
                maximum: 65_535
            },
            keepalive: {
                kind: 'integer',
                numericString: true,
                minimum: 0,
                maximum: 65_535
            },
            cleansession: {kind: 'boolean'}
        }
    },
    'tls-config': {
        fields: {
            name: {kind: 'string'},
            cert: {kind: 'string'},
            key: {kind: 'string'},
            ca: {kind: 'string'},
            verifyservercert: {kind: 'boolean'}
        }
    }
};

const NODE_RULES: Readonly<Record<string, NodeRule>> = {
    inject: {
        fields: {
            once: {kind: 'boolean'},
            onceDelay: {kind: 'number', numericString: true, minimum: 0},
            repeat: {kind: 'string'},
            crontab: {kind: 'string'}
        },
        outputs: 1
    },
    debug: {
        fields: {
            active: {kind: 'boolean'},
            tosidebar: {kind: 'boolean'},
            console: {kind: 'boolean'},
            complete: {kind: 'string'}
        },
        outputs: 0
    },
    change: {outputs: 1},
    switch: {
        fields: {outputs: {kind: 'integer', required: true, minimum: 1}},
        outputs: (record) => positiveInteger(record.outputs)
    },
    function: {
        fields: {
            func: {kind: 'string'},
            outputs: {kind: 'integer', minimum: 0},
            timeout: {kind: 'number', numericString: true, minimum: 0}
        },
        outputs: (record) => nonNegativeInteger(record.outputs)
    },
    delay: {
        fields: {
            timeout: {kind: 'string'},
            timeoutUnits: {
                kind: 'string',
                values: ['milliseconds', 'seconds', 'minutes', 'hours', 'days']
            },
            rate: {kind: 'string'},
            nbRateUnits: {kind: 'number', numericString: true, minimum: 1}
        },
        outputs: 1
    },
    trigger: {outputs: 1},
    template: {
        fields: {template: {kind: 'string'}, syntax: {kind: 'string'}},
        outputs: 1
    },
    'http in': {
        fields: {
            url: {kind: 'string', required: true},
            method: {
                kind: 'string',
                required: true,
                values: ['get', 'post', 'put', 'delete', 'patch', 'options']
            }
        },
        outputs: 1
    },
    'http response': {
        fields: {statusCode: {kind: 'string'}, headers: {kind: 'object'}},
        outputs: 0
    },
    'http request': {
        fields: {
            method: {kind: 'string', required: true},
            url: {kind: 'string'},
            ret: {kind: 'string', values: ['txt', 'bin', 'obj']}
        },
        references: [{property: 'tls', types: ['tls-config']}],
        outputs: 1
    },
    'mqtt in': {
        fields: {
            topic: {kind: 'string', required: true},
            qos: {kind: 'string'}
        },
        references: [
            {property: 'broker', types: ['mqtt-broker'], required: true}
        ],
        outputs: 1
    },
    'mqtt out': {
        fields: {topic: {kind: 'string'}, qos: {kind: 'string'}},
        references: [
            {property: 'broker', types: ['mqtt-broker'], required: true}
        ],
        outputs: 0
    },
    'link in': {outputs: 1},
    'link out': {outputs: 0},
    'link call': {outputs: 1},
    catch: {outputs: 1},
    status: {outputs: 1},
    complete: {outputs: 1},
    comment: {outputs: 0},
    'fm-target': {
        fields: {
            deviceIds: {kind: 'string'},
            groupIds: {kind: 'string'},
            locationIds: {kind: 'string'},
            tagKeys: {kind: 'string'},
            fleet: {kind: 'boolean'}
        },
        outputs: 1
    },
    'fm-device-event': {
        fields: {
            events: {kind: 'string'},
            filterJson: {kind: 'string'},
            ...DEVICE_SCOPE_FIELDS
        },
        references: [SERVER_REFERENCE],
        outputs: 1
    },
    'fm-trigger-threshold': {
        fields: {
            path: {kind: 'string', required: true},
            operator: {kind: 'string', values: ['above', 'below']},
            limit: {kind: 'number', numericString: true, required: true},
            forSeconds: {kind: 'integer', numericString: true, minimum: 0},
            fireOnStart: {kind: 'boolean'},
            ...DEVICE_SCOPE_FIELDS
        },
        references: [SERVER_REFERENCE],
        outputs: 2
    },
    'fm-trigger-status': {
        fields: {
            watch: {kind: 'string', values: ['both', 'offline', 'online']},
            forSeconds: {kind: 'integer', numericString: true, minimum: 0},
            outputCurrent: {kind: 'boolean'},
            ...DEVICE_SCOPE_FIELDS
        },
        references: [SERVER_REFERENCE],
        outputs: 1
    },
    'fm-trigger-button': {
        fields: {
            component: {kind: 'string'},
            eventTypes: {kind: 'string'},
            ...DEVICE_SCOPE_FIELDS
        },
        references: [SERVER_REFERENCE],
        outputs: 1
    },
    'fm-webhook-in': {
        fields: {
            hookId: {kind: 'string', required: true},
            respond: {kind: 'string', values: ['auto', 'flow']},
            allowQueryToken: {kind: 'boolean'}
        },
        references: [{property: 'server', types: ['fm-server']}],
        outputs: 1
    }
};

for (const type of FLEET_OPERATION_TYPES) {
    (NODE_RULES as Record<string, NodeRule>)[type] = {
        fields: {
            operation: {kind: 'string'},
            paramsSource: {
                kind: 'string',
                values: ['auto', 'msg.params', 'msg.payload', 'config', 'merge']
            },
            paramsJson: {kind: 'string'}
        },
        references: [
            {property: 'server', types: ['fm-server'], required: true}
        ],
        outputs: 1
    };
}

const PARTIALLY_VALIDATED_NODE_TYPES = Object.freeze([
    'mqtt-broker',
    'tls-config',
    'debug',
    'function',
    'http in',
    'http request',
    'http response',
    'mqtt in',
    'mqtt out',
    'switch',
    'catch',
    'change',
    'comment',
    'complete',
    'delay',
    'inject',
    'link call',
    'link in',
    'link out',
    'status',
    'template',
    'trigger'
]);

const VALIDATED_NODE_TYPES = Object.freeze(
    [...Object.keys(CONFIG_RULES), ...Object.keys(NODE_RULES)]
        .filter(
            (type) =>
                !(PARTIALLY_VALIDATED_NODE_TYPES as readonly string[]).includes(
                    type
                )
        )
        .sort()
);

function issue(
    code: string,
    path: string,
    message: string
): NodeConfigurationIssue {
    return {code, path, message};
}

function isRecord(value: unknown): value is FlowRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && Number(value) >= 0
        ? Number(value)
        : undefined;
}

function positiveInteger(value: unknown): number | undefined {
    return Number.isSafeInteger(value) && Number(value) > 0
        ? Number(value)
        : undefined;
}

function hasDangerousKey(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasDangerousKey);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(
        ([key, child]) =>
            key === '__proto__' ||
            key === 'prototype' ||
            key === 'constructor' ||
            hasDangerousKey(child)
    );
}

function matchesKind(value: unknown, kind: ValueKind): boolean {
    if (kind === 'object') return isRecord(value);
    if (kind === 'integer') return Number.isSafeInteger(value);
    if (kind === 'number') {
        return typeof value === 'number' && Number.isFinite(value);
    }
    return typeof value === kind;
}

function validateFields(
    record: FlowRecord,
    path: string,
    rules: Readonly<Record<string, FieldRule>>
): NodeConfigurationIssue[] {
    const issues: NodeConfigurationIssue[] = [];
    for (const [property, rule] of Object.entries(rules)) {
        const rawValue = record[property];
        const value =
            rule.numericString &&
            typeof rawValue === 'string' &&
            rawValue.trim() !== ''
                ? Number(rawValue)
                : rawValue;
        const propertyPath = `${path}.${property}`;
        if (value === undefined || value === null || value === '') {
            if (rule.required) {
                issues.push(
                    issue('property_required', propertyPath, 'is required')
                );
            }
            continue;
        }
        if (!matchesKind(value, rule.kind)) {
            issues.push(
                issue('property_type', propertyPath, `must be ${rule.kind}`)
            );
            continue;
        }
        if (rule.values && !rule.values.includes(value)) {
            issues.push(
                issue(
                    'property_value',
                    propertyPath,
                    'has an unsupported value'
                )
            );
        }
        if (
            typeof value === 'number' &&
            ((rule.minimum !== undefined && value < rule.minimum) ||
                (rule.maximum !== undefined && value > rule.maximum))
        ) {
            issues.push(
                issue(
                    'property_range',
                    propertyPath,
                    'is outside the supported range'
                )
            );
        }
    }
    return issues;
}

function validateReferences(
    record: FlowRecord,
    path: string,
    rules: readonly ReferenceRule[],
    configsById: ReadonlyMap<string, FlowRecord>
): NodeConfigurationIssue[] {
    const issues: NodeConfigurationIssue[] = [];
    for (const rule of rules) {
        const value = record[rule.property];
        const propertyPath = `${path}.${rule.property}`;
        if (typeof value !== 'string' || !value.trim()) {
            if (rule.required) {
                issues.push(
                    issue(
                        'config_reference_missing',
                        propertyPath,
                        'is required'
                    )
                );
            }
            continue;
        }
        const target = configsById.get(value);
        if (!target) {
            issues.push(
                issue(
                    'config_reference_missing',
                    propertyPath,
                    `references missing config ${value}`
                )
            );
        } else if (!rule.types.includes(String(target.type))) {
            issues.push(
                issue(
                    'config_reference_type',
                    propertyPath,
                    'references the wrong config type'
                )
            );
        }
    }
    return issues;
}

function validateOutputWires(
    record: FlowRecord,
    path: string,
    expectedOutputs: number | undefined,
    nodeIds: ReadonlySet<string>
): NodeConfigurationIssue[] {
    if (!Array.isArray(record.wires)) return [];
    const issues: NodeConfigurationIssue[] = [];
    if (
        expectedOutputs !== undefined &&
        record.wires.length > expectedOutputs
    ) {
        issues.push(
            issue(
                'wire_output_count',
                `${path}.wires`,
                `cannot exceed ${expectedOutputs} output arrays`
            )
        );
    }
    record.wires.forEach((output, outputIndex) => {
        if (!Array.isArray(output)) return;
        output.forEach((target, targetIndex) => {
            if (typeof target === 'string' && !nodeIds.has(target)) {
                issues.push(
                    issue(
                        'wire_target_missing',
                        `${path}.wires[${outputIndex}][${targetIndex}]`,
                        `references missing node ${target}`
                    )
                );
            }
        });
    });
    return issues;
}

function validateJsonObjectProperty(
    record: FlowRecord,
    path: string,
    property: string
): NodeConfigurationIssue[] {
    const value = record[property];
    if (value === undefined || value === '') return [];
    if (typeof value !== 'string') return [];
    try {
        const parsed: unknown = JSON.parse(value);
        if (isRecord(parsed) && !hasDangerousKey(parsed)) return [];
    } catch {
        // The stable issue below covers malformed JSON and non-object JSON.
    }
    return [
        issue(
            'property_json_object',
            `${path}.${property}`,
            'must be JSON for an object without prototype-mutating keys'
        )
    ];
}

function installedDefinition(
    record: FlowRecord,
    definitions: NodeRedNodeDefinitions | null
): NodeRedNodeDefinition | undefined {
    const type = String(record.type ?? '');
    return definitions && Object.hasOwn(definitions.types, type)
        ? definitions.types[type]
        : undefined;
}

function handRuleIssues(
    record: FlowRecord,
    path: string,
    rules: NodeRule,
    context: ScopeContext
): NodeConfigurationIssue[] {
    const issues: NodeConfigurationIssue[] = [];
    if (rules.fields)
        issues.push(...validateFields(record, path, rules.fields));
    if (rules.references) {
        issues.push(
            ...validateReferences(
                record,
                path,
                rules.references,
                context.configsById
            )
        );
    }
    if (
        FLEET_OPERATION_TYPES.includes(
            record.type as (typeof FLEET_OPERATION_TYPES)[number]
        )
    ) {
        issues.push(...validateJsonObjectProperty(record, path, 'paramsJson'));
    }
    if (record.type === 'fm-device-event') {
        issues.push(...validateJsonObjectProperty(record, path, 'filterJson'));
    }
    return issues;
}

function expectedOutputs(
    record: FlowRecord,
    rules: NodeRule | undefined,
    context: ScopeContext
): number | undefined {
    if (rules) {
        return typeof rules.outputs === 'function'
            ? rules.outputs(record)
            : rules.outputs;
    }
    const type = String(record.type ?? '');
    if (type.startsWith('subflow:')) {
        return context.subflowOutputs.get(type.slice('subflow:'.length));
    }
    const definition = installedDefinition(record, context.definitions);
    return definition ? definitionOutputs(record, definition) : undefined;
}

// Hand rules and installed definitions can name the same fault once each.
function withoutDuplicates(
    issues: NodeConfigurationIssue[]
): NodeConfigurationIssue[] {
    const seen = new Set<string>();
    return issues.filter((item) => {
        const key = `${item.code}\u0000${item.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function validateRecord(
    record: FlowRecord,
    path: string,
    rules: NodeRule | undefined,
    context: ScopeContext
): NodeConfigurationIssue[] {
    const issues: NodeConfigurationIssue[] = [];
    if (hasDangerousKey(record)) {
        issues.push(
            issue(
                'dangerous_property',
                path,
                'contains a prototype-mutating property name'
            )
        );
    }
    if (rules) issues.push(...handRuleIssues(record, path, rules, context));
    const definition = installedDefinition(record, context.definitions);
    if (definition) {
        issues.push(
            ...checkAgainstDefinition({
                record,
                path,
                definition,
                configsById: context.configsById,
                registeredTypes: context.registeredTypes
            })
        );
    }
    issues.push(
        ...validateOutputWires(
            record,
            path,
            expectedOutputs(record, rules, context),
            context.nodeIds
        )
    );
    return withoutDuplicates(issues);
}

function validateSubflowInterface(
    subflow: SubflowInput,
    path: string
): NodeConfigurationIssue[] {
    const issues: NodeConfigurationIssue[] = [];
    const nodesById = new Map(
        subflow.nodes.map((node) => [String(node.id), node])
    );
    for (const property of ['in', 'out'] as const) {
        const ports = subflow.properties[property];
        if (ports === undefined) continue;
        if (!Array.isArray(ports)) {
            issues.push(
                issue(
                    'subflow_interface_type',
                    `${path}.properties.${property}`,
                    'must be an array'
                )
            );
            continue;
        }
        ports.forEach((port, portIndex) => {
            const portPath = `${path}.properties.${property}[${portIndex}]`;
            if (!isRecord(port) || !Array.isArray(port.wires)) {
                issues.push(
                    issue(
                        'subflow_interface_type',
                        portPath,
                        'must contain a wires array'
                    )
                );
                return;
            }
            port.wires.forEach((wire, wireIndex) => {
                const wirePath = `${portPath}.wires[${wireIndex}]`;
                if (!isRecord(wire) || typeof wire.id !== 'string') {
                    issues.push(
                        issue(
                            'subflow_interface_type',
                            wirePath,
                            'must name a child node id'
                        )
                    );
                    return;
                }
                const target = nodesById.get(wire.id);
                const fromInput = property === 'out' && wire.id === subflow.id;
                if (!target && !fromInput) {
                    issues.push(
                        issue(
                            'subflow_wire_target_missing',
                            `${wirePath}.id`,
                            `references missing node ${wire.id}`
                        )
                    );
                }
                const port = Number(wire.port);
                const targetRule = Object.hasOwn(
                    NODE_RULES,
                    String(target?.type)
                )
                    ? NODE_RULES[String(target?.type)]
                    : undefined;
                const outputCount = fromInput
                    ? Array.isArray(subflow.properties.in)
                        ? subflow.properties.in.length
                        : 0
                    : typeof targetRule?.outputs === 'function'
                      ? targetRule.outputs(target ?? {})
                      : targetRule?.outputs;
                if (
                    property === 'out' &&
                    (!Number.isSafeInteger(wire.port) ||
                        port < 0 ||
                        (outputCount !== undefined && port >= outputCount))
                ) {
                    issues.push(
                        issue(
                            'subflow_wire_port_range',
                            `${wirePath}.port`,
                            'must be a non-negative integer within the child output range'
                        )
                    );
                }
            });
        });
    }
    return issues;
}

export function validateNodeConfigurations(
    input: NodeConfigurationValidationInput
): NodeConfigurationIssue[] {
    const issues: NodeConfigurationIssue[] = [];
    const globalConfigs = [
        ...(input.externalConfigs ?? []),
        ...input.graph.configs
    ];
    const subflowOutputs = new Map(
        input.graph.subflows.map((subflow) => [
            subflow.id,
            Array.isArray(subflow.properties.out)
                ? subflow.properties.out.length
                : 0
        ])
    );
    const definitions = input.definitions ?? null;
    const registeredTypes = new Set(Object.keys(definitions?.types ?? {}));
    const validateScope = (
        nodes: FlowRecord[],
        configs: FlowRecord[],
        path: string
    ): void => {
        const allConfigs = [...globalConfigs, ...configs];
        const context: ScopeContext = {
            configsById: new Map(
                allConfigs.map((record) => [String(record.id), record])
            ),
            nodeIds: new Set(nodes.map((record) => String(record.id))),
            subflowOutputs,
            definitions,
            registeredTypes
        };
        configs.forEach((record, index) => {
            issues.push(
                ...validateRecord(
                    record,
                    `${path}.configs[${index}]`,
                    Object.hasOwn(CONFIG_RULES, String(record.type))
                        ? CONFIG_RULES[String(record.type)]
                        : undefined,
                    context
                )
            );
        });
        nodes.forEach((record, index) => {
            issues.push(
                ...validateRecord(
                    record,
                    `${path}.nodes[${index}]`,
                    Object.hasOwn(NODE_RULES, String(record.type))
                        ? NODE_RULES[String(record.type)]
                        : undefined,
                    context
                )
            );
        });
    };

    validateScope(input.graph.nodes, input.graph.configs, 'graph');
    input.graph.subflows.forEach((subflow, index) => {
        const path = `graph.subflows[${index}]`;
        issues.push(...validateSubflowInterface(subflow, path));
        validateScope(subflow.nodes, subflow.configs, path);
    });
    return issues;
}

function handRuleCoverage(
    installedNodeTypes: ReadonlySet<string>
): NodeConfigurationValidationCoverage {
    const supported = new Set([
        ...VALIDATED_NODE_TYPES,
        ...PARTIALLY_VALIDATED_NODE_TYPES
    ]);
    return {
        version: 1,
        definitionSource: 'unavailable',
        validatedNodeTypes: [...VALIDATED_NODE_TYPES],
        partiallyValidatedNodeTypes: [...PARTIALLY_VALIDATED_NODE_TYPES],
        unvalidatedInstalledNodeTypes: [...installedNodeTypes]
            .filter(
                (type) => !supported.has(type) && !type.startsWith('subflow:')
            )
            .sort(),
        uncheckedProperties: [],
        evaluatesEditorJavaScript: false
    };
}

function definitionCoverage(
    installedNodeTypes: ReadonlySet<string>,
    definitions: NodeRedNodeDefinitions
): NodeConfigurationValidationCoverage {
    const types = [
        ...new Set([...installedNodeTypes, ...Object.keys(definitions.types)])
    ]
        .filter((type) => !type.startsWith('subflow:'))
        .sort();
    const uncheckedProperties = types.flatMap((type) => {
        const definition = Object.hasOwn(definitions.types, type)
            ? definitions.types[type]
            : undefined;
        const properties = definition
            ? uncheckedDefinitionProperties(definition)
            : [];
        return properties.length > 0 ? [{type, properties}] : [];
    });
    const partial = new Set(uncheckedProperties.map((entry) => entry.type));
    const described = (type: string) =>
        Object.hasOwn(definitions.types, type) ||
        Object.hasOwn(NODE_RULES, type) ||
        Object.hasOwn(CONFIG_RULES, type);
    return {
        version: 1,
        definitionSource: 'installed-node-red',
        validatedNodeTypes: types.filter(
            (type) => described(type) && !partial.has(type)
        ),
        partiallyValidatedNodeTypes: [...partial],
        unvalidatedInstalledNodeTypes: types.filter((type) => !described(type)),
        uncheckedProperties,
        evaluatesEditorJavaScript: false
    };
}

export function nodeConfigurationValidationCoverage(
    installedNodeTypes: ReadonlySet<string> = new Set(),
    definitions: NodeRedNodeDefinitions | null = null
): NodeConfigurationValidationCoverage {
    return definitions
        ? definitionCoverage(installedNodeTypes, definitions)
        : handRuleCoverage(installedNodeTypes);
}
