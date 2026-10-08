import {describeSchema, type JsonSchema} from '../../types/api/_schema';
import {
    OPERATIONAL_POLICY_FAMILIES,
    OPERATIONS_DESCRIBE,
    type OperationalPolicyFamily,
    type OperationalPolicyRegistry,
    type OperationalPolicyRegistryEntry,
    type OperationalPolicySelectorBinding,
    type OperationEvaluatorBlock,
    type OperationPolicyIdentifierField,
    type OperationScopeKind,
    type OperationSourceSelector,
    type OperationStorageAdapter
} from '../../types/api/operations';

interface OperationPermission {
    component: 'organizations';
    operation: 'read' | 'update';
}

export interface OperationDefinition
    extends Omit<
        OperationalPolicyRegistryEntry,
        | 'editableFields'
        | 'policyIdField'
        | 'policySchema'
        | 'setMethod'
        | 'selectorBindings'
    > {
    readonly family: OperationalPolicyFamily;
    readonly label: string;
    readonly description: string;
    readonly scopes: readonly OperationScopeKind[];
    readonly sourceSelectors: readonly OperationSourceSelector[];
    readonly storage: OperationStorageAdapter;
    readonly evaluatorBlocks: readonly OperationEvaluatorBlock[];
    readonly policy: {readonly setMethod: string; readonly parameter: 'policy'};
    readonly verdictMethod: string;
    readonly permissions: {
        readonly read: OperationPermission;
        readonly write: OperationPermission;
    };
    readonly resultStates: readonly string[];
}

const STANDARD_PERMISSIONS = {
    read: {component: 'organizations', operation: 'read'},
    write: {component: 'organizations', operation: 'update'}
} as const;

export const OPERATION_DEFINITIONS: Readonly<
    Record<OperationalPolicyFamily, OperationDefinition>
> = {
    refrigeration: definition({
        family: 'refrigeration',
        label: 'Refrigeration peer health',
        description:
            'Compare configured refrigeration energy sources with their configured peers.',
        scopes: ['organization', 'location'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'freshness',
            'peer-comparison',
            'aggregation'
        ],
        setMethod: 'SetRefrigerationPeerPolicy',
        verdictMethod: 'GetRefrigerationPeerHealth',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'unrated',
            'healthy',
            'attention'
        ]
    }),
    coldChain: definition({
        family: 'coldChain',
        label: 'Cold-chain daily record',
        description:
            'Evaluate configured temperature sources, daily evidence completion, limits, freshness, and deadline state.',
        scopes: ['location'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'range',
            'freshness',
            'schedule',
            'aggregation'
        ],
        setMethod: 'SetColdChainRecordPolicy',
        verdictMethod: 'GetColdChainRecordVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'complete',
            'incomplete',
            'overdue'
        ]
    }),
    parking: definition({
        family: 'parking',
        label: 'Parking occupancy and safety',
        description:
            'Evaluate configured parking occupancy, smoke, flood, and gas sources.',
        scopes: ['location'],
        sourceSelectors: ['custom-device-role'],
        storage: 'profile-metadata',
        evaluatorBlocks: ['scope', 'range', 'freshness', 'aggregation'],
        setMethod: 'SetParkingOperationalPolicy',
        verdictMethod: 'GetParkingOperationalVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'operational',
            'clear',
            'alarm'
        ]
    }),
    irrigation: definition({
        family: 'irrigation',
        label: 'Irrigation schedule',
        description:
            'Evaluate configured watering schedules, completion, and skip sensors.',
        scopes: ['organization', 'location'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'schedule',
            'freshness',
            'range',
            'duration'
        ],
        setMethod: 'SetIrrigationPolicy',
        verdictMethod: 'GetIrrigationVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'scheduled',
            'completed',
            'skipped_by_policy',
            'missed'
        ]
    }),
    pv: definition({
        family: 'pv',
        label: 'PV generation health',
        description:
            'Compare configured PV generation sources over one configured period.',
        scopes: ['organization', 'location'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'freshness',
            'peer-comparison',
            'aggregation'
        ],
        setMethod: 'SetPvHealthPolicy',
        verdictMethod: 'GetPvHealthVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'healthy',
            'attention'
        ]
    }),
    italiaPoolChemistry: definition({
        family: 'italiaPoolChemistry',
        label: 'Pool chemistry register',
        description:
            'Evaluate configured pool register bands and measured or entered daily values.',
        scopes: ['location'],
        sourceSelectors: ['physical-device', 'manual-entry'],
        storage: 'pool-register',
        evaluatorBlocks: [
            'scope',
            'schedule',
            'range',
            'freshness',
            'sequence',
            'aggregation'
        ],
        setMethod: 'SetItaliaPoolChemistryPolicy',
        verdictMethod: 'GetItaliaPoolRegister',
        resultStates: [
            'config_missing',
            'configured',
            'present',
            'owed',
            'within',
            'below',
            'above'
        ]
    }),
    italiaHotWater: definition({
        family: 'italiaHotWater',
        label: 'Hot-water operation',
        description:
            'Evaluate configured hot-water blocks, hold periods, gaps, and reopening flushes.',
        scopes: ['location'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'range',
            'freshness',
            'duration',
            'sequence',
            'aggregation'
        ],
        setMethod: 'SetItaliaHotWaterPolicy',
        verdictMethod: 'GetItaliaHotWaterVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'below_limit',
            'holding',
            'complete'
        ]
    }),
    italiaNightFlow: definition({
        family: 'italiaNightFlow',
        label: 'Night-flow monitoring',
        description:
            'Evaluate configured quiet-window flow against Fleet history.',
        scopes: ['location'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'freshness',
            'duration',
            'peer-comparison',
            'aggregation'
        ],
        setMethod: 'SetItaliaNightFlowPolicy',
        verdictMethod: 'GetItaliaNightFlowVerdicts',
        resultStates: [
            'config_missing',
            'data_missing',
            'insufficient_baseline',
            'normal',
            'leak'
        ]
    }),
    italiaPitch: definition({
        family: 'italiaPitch',
        label: 'Pitch electrical load',
        description:
            'Evaluate one configured pitch source against its rating and disconnect duration.',
        scopes: ['device'],
        sourceSelectors: ['physical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: ['scope', 'range', 'freshness', 'duration'],
        setMethod: 'SetItaliaPitchPolicy',
        verdictMethod: 'GetItaliaPitchVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'stale',
            'normal',
            'warning',
            'overload'
        ]
    }),
    italiaSitePower: definition({
        family: 'italiaSitePower',
        label: 'Site electrical capacity',
        description:
            'Evaluate one site logical meter against its configured contracted and available power.',
        scopes: ['location'],
        sourceSelectors: ['logical-meter'],
        storage: 'profile-metadata',
        evaluatorBlocks: ['scope', 'range', 'freshness', 'aggregation'],
        setMethod: 'SetItaliaSitePowerPolicy',
        verdictMethod: 'GetItaliaSitePowerVerdict',
        resultStates: [
            'config_missing',
            'data_missing',
            'freshness_missing',
            'normal',
            'warning',
            'overload'
        ]
    }),
    italiaBreakerTrips: definition({
        family: 'italiaBreakerTrips',
        label: 'Pitch breaker trips',
        description:
            'Count breaker counter increases over one configured window without inferring trips from power.',
        scopes: ['location', 'device'],
        sourceSelectors: ['logical-device'],
        storage: 'profile-metadata',
        evaluatorBlocks: [
            'scope',
            'sequence',
            'counter-difference',
            'aggregation'
        ],
        setMethod: 'SetItaliaBreakerTripPolicy',
        verdictMethod: 'GetItaliaBreakerTripVerdict',
        resultStates: [
            'config_missing',
            'no_readings',
            'one_reading',
            'counter_reset',
            'complete'
        ]
    })
};

assertRegistryComplete();

export function requireOperationDefinition(
    family: unknown
): OperationDefinition {
    if (
        typeof family !== 'string' ||
        !OPERATIONAL_POLICY_FAMILIES.includes(family as OperationalPolicyFamily)
    )
        throw new Error('operational policy family is not registered');
    return OPERATION_DEFINITIONS[family as OperationalPolicyFamily];
}

export function editablePolicyFields(
    family: OperationalPolicyFamily
): string[] {
    return Object.keys(policySchemaFor(family).properties ?? {}).sort();
}

export function operationalPolicyRegistry(): OperationalPolicyRegistry {
    return {
        operations: Object.values(OPERATION_DEFINITIONS).map((definition) => ({
            family: definition.family,
            label: definition.label,
            description: definition.description,
            scopes: [...definition.scopes],
            sourceSelectors: [...definition.sourceSelectors],
            selectorBindings: operationSelectorBindings(definition.family),
            storage: definition.storage,
            evaluatorBlocks: [...definition.evaluatorBlocks],
            setMethod: definition.policy.setMethod,
            verdictMethod: definition.verdictMethod,
            permissions: {
                read: {...definition.permissions.read},
                write: {...definition.permissions.write}
            },
            resultStates: [...definition.resultStates],
            policyIdField: policyIdField(definition.family),
            editableFields: editablePolicyFields(definition.family),
            policySchema: describeSchema(policySchemaFor(definition.family))
        }))
    };
}

export function operationSelectorBindings(
    family: OperationalPolicyFamily
): OperationalPolicySelectorBinding[] {
    const physical = (
        path: string,
        sourceType: NonNullable<OperationalPolicySelectorBinding['sourceType']>,
        apply: Record<string, string>,
        locationRelation?: OperationalPolicySelectorBinding['locationRelation']
    ): OperationalPolicySelectorBinding => ({
        path,
        collection: 'physicalSources',
        sourceType,
        ...(locationRelation ? {locationRelation} : {}),
        apply
    });
    switch (family) {
        case 'refrigeration':
            return [
                {path: '', collection: 'locations', apply: {locationId: 'id'}},
                physical('sources[]', 'energy', {
                    deviceId: 'deviceId',
                    channel: 'channel',
                    tag: 'tag'
                })
            ];
        case 'coldChain':
            return [
                {path: '', collection: 'locations', apply: {locationId: 'id'}},
                physical('sources[]', 'numeric', {
                    deviceId: 'deviceId',
                    kind: 'kind',
                    source: 'source',
                    channel: 'channel'
                })
            ];
        case 'parking':
            return [
                {path: '', collection: 'locations', apply: {locationId: 'id'}},
                {
                    path: 'sources[]',
                    collection: 'customDeviceRoles',
                    apply: {
                        customDeviceId: 'customDeviceId',
                        roleKey: 'roleKey'
                    }
                },
                {
                    path: 'safetySources[]',
                    collection: 'customDeviceRoles',
                    apply: {
                        customDeviceId: 'customDeviceId',
                        roleKey: 'roleKey'
                    }
                }
            ];
        case 'irrigation':
            return [
                {path: '', collection: 'locations', apply: {locationId: 'id'}},
                physical('valve', 'event', {
                    deviceId: 'deviceId',
                    kind: 'kind',
                    channel: 'channel'
                }),
                physical('soil', 'numeric', {
                    deviceId: 'deviceId',
                    kind: 'kind',
                    source: 'source',
                    channel: 'channel'
                }),
                physical('rain', 'numeric', {
                    deviceId: 'deviceId',
                    kind: 'kind',
                    source: 'source',
                    channel: 'channel'
                })
            ];
        case 'pv':
            return [
                {path: '', collection: 'locations', apply: {locationId: 'id'}},
                physical('sources[]', 'energy', {
                    deviceId: 'deviceId',
                    channel: 'channel',
                    tag: 'tag'
                })
            ];
        case 'italiaPoolChemistry':
            return [
                {path: '', collection: 'locations', apply: {siteId: 'id'}},
                physical('sources[]', 'numeric', {
                    deviceId: 'deviceId',
                    kind: 'kind',
                    source: 'source',
                    channel: 'channel'
                })
            ];
        case 'italiaHotWater':
            return [
                {path: '', collection: 'locations', apply: {siteId: 'id'}},
                physical('blocks[]', 'numeric', {
                    deviceId: 'deviceId',
                    kind: 'kind',
                    source: 'source',
                    channel: 'channel'
                })
            ];
        case 'italiaNightFlow':
            return [
                {path: '', collection: 'locations', apply: {siteId: 'id'}},
                {
                    path: 'zones[]',
                    collection: 'locations',
                    locationKinds: ['zone'],
                    apply: {zoneId: 'id'}
                },
                physical('zones[].sources[]', 'energy', {
                    deviceId: 'deviceId',
                    channel: 'channel',
                    tag: 'tag'
                })
            ];
        case 'italiaPitch':
            return [
                {path: '', collection: 'locations', apply: {pitchId: 'id'}},
                physical(
                    '',
                    'switchCurrent',
                    {
                        deviceId: 'deviceId',
                        component: 'component',
                        channel: 'channel'
                    },
                    'selected-or-parent'
                )
            ];
        case 'italiaSitePower':
            return [
                {path: '', collection: 'locations', apply: {siteId: 'id'}},
                {
                    path: '',
                    collection: 'logicalMeters',
                    apply: {meterId: 'meterId'}
                }
            ];
        case 'italiaBreakerTrips':
            return [
                {path: '', collection: 'locations', apply: {pitchId: 'id'}},
                {
                    path: '',
                    collection: 'logicalDevices',
                    apply: {
                        logicalDeviceId: 'logicalDeviceId',
                        component: 'component',
                        counterField: 'counterField'
                    }
                }
            ];
    }
}

export function policyIdField(family: 'italiaPoolChemistry'): 'poolId';
export function policyIdField(
    family: Exclude<OperationalPolicyFamily, 'italiaPoolChemistry'>
): Exclude<OperationPolicyIdentifierField, 'poolId'>;
export function policyIdField(
    family: OperationalPolicyFamily
): OperationPolicyIdentifierField;
export function policyIdField(
    family: OperationalPolicyFamily
): OperationPolicyIdentifierField {
    if (family === 'italiaPoolChemistry') return 'poolId';
    if (family === 'parking') return 'locationId';
    if (
        family === 'italiaHotWater' ||
        family === 'italiaNightFlow' ||
        family === 'italiaSitePower'
    )
        return 'siteId';
    if (family === 'italiaPitch' || family === 'italiaBreakerTrips')
        return 'pitchId';
    return 'id';
}

function policySchemaFor(family: OperationalPolicyFamily): JsonSchema {
    const definition = OPERATION_DEFINITIONS[family];
    const policy =
        OPERATIONS_DESCRIBE.methods[definition.policy.setMethod]?.params
            .properties?.[definition.policy.parameter];
    if (!policy?.properties)
        throw new Error(
            `${definition.policy.setMethod} has no policy object schema`
        );
    return policy;
}

function definition(
    input: Omit<OperationDefinition, 'policy' | 'permissions'> & {
        setMethod: string;
    }
): OperationDefinition {
    const {setMethod, ...values} = input;
    return {
        ...values,
        policy: {setMethod, parameter: 'policy'},
        permissions: STANDARD_PERMISSIONS
    };
}

function assertRegistryComplete(): void {
    const registered = Object.keys(OPERATION_DEFINITIONS);
    if (
        registered.length !== OPERATIONAL_POLICY_FAMILIES.length ||
        OPERATIONAL_POLICY_FAMILIES.some(
            (family) => !registered.includes(family)
        )
    )
        throw new Error(
            'Operations registry does not cover every policy family'
        );
}
