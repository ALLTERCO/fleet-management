import {DescribeBuilder, type DescribeOutput} from './_describe';
import type {JsonSchema} from './_schema';
import {
    MAX_BATCH_SIZE,
    METADATA_MAX_BYTES,
    ORG_ID_SCHEMA,
    SHELLY_ID_SCHEMA
} from './_shared';

export const REFRIGERATION_PEER_ENERGY_STATUSES = [
    'config_missing',
    'data_missing',
    'stale',
    'unrated',
    'healthy',
    'attention'
] as const;
export type RefrigerationPeerEnergyStatus =
    (typeof REFRIGERATION_PEER_ENERGY_STATUSES)[number];
export type RefrigerationPeerEnergyUnratedReason =
    | 'insufficient_peers'
    | 'zero_median';

export const COLD_CHAIN_RECORD_STATUSES = [
    'config_missing',
    'data_missing',
    'stale',
    'complete',
    'incomplete',
    'overdue'
] as const;
export type ColdChainRecordStatus = (typeof COLD_CHAIN_RECORD_STATUSES)[number];
export const COLD_CHAIN_CASE_STATUSES = [
    'data_missing',
    'stale',
    'within_limit',
    'above_limit'
] as const;
export type ColdChainCaseStatus = (typeof COLD_CHAIN_CASE_STATUSES)[number];

export const PARKING_OCCUPANCY_STATUSES = [
    'config_missing',
    'data_missing',
    'stale',
    'operational'
] as const;
export type ParkingOccupancyStatus =
    (typeof PARKING_OCCUPANCY_STATUSES)[number];
export const PARKING_SPOT_STATUSES = [
    'data_missing',
    'stale',
    'occupied',
    'available'
] as const;
export type ParkingSpotStatus = (typeof PARKING_SPOT_STATUSES)[number];
export const PARKING_SAFETY_STATUSES = [
    'config_missing',
    'data_missing',
    'stale',
    'clear',
    'alarm'
] as const;
export type ParkingSafetyStatus = (typeof PARKING_SAFETY_STATUSES)[number];

export const OPERATIONAL_POLICY_FAMILIES = [
    'refrigeration',
    'coldChain',
    'parking',
    'irrigation',
    'pv',
    'italiaPoolChemistry',
    'italiaHotWater',
    'italiaNightFlow',
    'italiaPitch',
    'italiaSitePower',
    'italiaBreakerTrips'
] as const;
export type OperationalPolicyFamily =
    (typeof OPERATIONAL_POLICY_FAMILIES)[number];
export const OPERATION_EVALUATOR_BLOCKS = [
    'range',
    'freshness',
    'duration',
    'peer-comparison',
    'schedule',
    'sequence',
    'counter-difference',
    'aggregation',
    'scope'
] as const;
export type OperationEvaluatorBlock =
    (typeof OPERATION_EVALUATOR_BLOCKS)[number];
export const OPERATION_SCOPE_KINDS = [
    'organization',
    'location',
    'device'
] as const;
export type OperationScopeKind = (typeof OPERATION_SCOPE_KINDS)[number];
export const OPERATION_SOURCE_SELECTORS = [
    'physical-device',
    'logical-device',
    'logical-meter',
    'custom-device-role',
    'manual-entry'
] as const;
export type OperationSourceSelector =
    (typeof OPERATION_SOURCE_SELECTORS)[number];
export const OPERATION_STORAGE_ADAPTERS = [
    'profile-metadata',
    'pool-register'
] as const;
export type OperationStorageAdapter =
    (typeof OPERATION_STORAGE_ADAPTERS)[number];
export const OPERATION_POLICY_IDENTIFIER_FIELDS = [
    'id',
    'poolId',
    'locationId',
    'siteId',
    'pitchId'
] as const;
export type OperationPolicyIdentifierField =
    (typeof OPERATION_POLICY_IDENTIFIER_FIELDS)[number];

export interface OperationalPolicyRegistryPermission {
    component: 'organizations';
    operation: 'read' | 'update';
}

export interface OperationalPolicyRegistryEntry {
    family: OperationalPolicyFamily;
    label: string;
    description: string;
    scopes: readonly OperationScopeKind[];
    sourceSelectors: readonly OperationSourceSelector[];
    selectorBindings: readonly OperationalPolicySelectorBinding[];
    storage: OperationStorageAdapter;
    evaluatorBlocks: readonly OperationEvaluatorBlock[];
    setMethod: string;
    verdictMethod: string;
    permissions: {
        read: OperationalPolicyRegistryPermission;
        write: OperationalPolicyRegistryPermission;
    };
    resultStates: readonly string[];
    policyIdField: OperationPolicyIdentifierField;
    editableFields: readonly string[];
    policySchema: JsonSchema;
}

/** Declarative editor mapping from one policy JSON path to catalog fields. */
export interface OperationalPolicySelectorBinding {
    path: string;
    collection:
        | 'locations'
        | 'physicalSources'
        | 'logicalMeters'
        | 'logicalDevices'
        | 'customDeviceRoles';
    sourceType?: OperationalPhysicalSourceChoice['sourceType'];
    locationRelation?: 'selected' | 'selected-or-parent';
    locationKinds?: readonly string[];
    apply: Readonly<Record<string, string>>;
}

export interface OperationalPolicyRegistry {
    operations: readonly OperationalPolicyRegistryEntry[];
}

export interface OperationalPolicyLocationChoice {
    id: number;
    name: string;
    kind: string;
    parentLocationId: number | null;
    timeZone: string | null;
}

/** Complete physical identities selected by the Operations editor. */
export type OperationalPhysicalSourceChoice =
    | {
          sourceType: 'energy';
          deviceId: string;
          label: string;
          locationId: number | null;
          component: string | null;
          channel: number;
          tag: string;
      }
    | {
          sourceType: 'numeric' | 'event';
          deviceId: string;
          label: string;
          locationId: number | null;
          kind: string;
          source: string;
          channel: number;
      }
    | {
          sourceType: 'switchCurrent';
          deviceId: string;
          label: string;
          locationId: number | null;
          component: 'switch';
          channel: number;
      };

export interface OperationalLogicalMeterChoice {
    meterId: number;
    name: string;
    locationId: number | null;
    utilityType: string;
    aggregationMode: string;
    pointCount: number;
}

export interface OperationalLogicalDeviceChoice {
    logicalDeviceId: number;
    deviceId: string;
    label: string;
    locationId: number;
    component: string;
    counterField: string;
}

export interface OperationalCustomDeviceRoleChoice {
    customDeviceId: string;
    deviceName: string;
    locationId: number | null;
    roleKey: string;
    label: string;
    valueType: 'boolean' | 'number' | 'string' | 'event' | 'json' | null;
}

export interface OperationalPolicySelectorCatalog {
    family: OperationalPolicyFamily;
    locations: readonly OperationalPolicyLocationChoice[];
    physicalSources: readonly OperationalPhysicalSourceChoice[];
    logicalMeters: readonly OperationalLogicalMeterChoice[];
    logicalDevices: readonly OperationalLogicalDeviceChoice[];
    customDeviceRoles: readonly OperationalCustomDeviceRoleChoice[];
}

export interface OperationalPolicySelectorCatalogParams {
    organizationId?: string;
    family: OperationalPolicyFamily;
    locationId?: number;
}
export const OPERATIONAL_POLICY_MAX_COUNT = MAX_BATCH_SIZE;
export const OPERATIONAL_POLICY_MAX_SOURCES = MAX_BATCH_SIZE;

export interface OperationalSource {
    deviceId: string;
    channel: string;
}

export interface RefrigerationPeerEnergySource {
    id: string;
    deviceId: string;
    channel: number;
    tag: string;
    peerGroupIds: string[];
}

export interface RefrigerationPeerPolicy {
    id: string;
    locationId?: number;
    freshnessSec: number;
    thresholdPct: number;
    minPeerCount: number;
    sources: RefrigerationPeerEnergySource[];
}

export interface ColdChainRecordSource {
    id: string;
    deviceId: string;
    kind: string;
    source: string;
    channel: number;
    evidenceRequired: boolean;
    maxTemperatureC: number | null;
    limitBasis: 'statutory' | 'industry_practice' | 'custom' | null;
}

export interface ColdChainRecordPolicy {
    id: string;
    locationId: number;
    timeZone: string;
    freshnessSeconds: number;
    deadlineHour: number;
    retentionDays: number;
    sources: ColdChainRecordSource[];
}

export interface ColdChainRecordSourceVerdict {
    sourceId: string;
    deviceId: string;
    status: ColdChainCaseStatus;
    observedAt: string | null;
    temperatureC: number | null;
    maxTemperatureC: number | null;
    limitBasis: ColdChainRecordSource['limitBasis'];
    evidenceRequired: boolean;
    loggedToday: boolean;
    neverReported: boolean | null;
    silenceHours: number | null;
}

export interface ColdChainRecordVerdict {
    policyId: string;
    date: string | null;
    status: ColdChainRecordStatus;
    complete: boolean;
    overdue: boolean;
    coverage: OperationalCoverage;
    sources: ColdChainRecordSourceVerdict[];
}

interface ParkingSourceIdentity {
    id: string;
    customDeviceId: string;
    roleKey: string;
}

export interface ParkingDistanceRatioSource extends ParkingSourceIdentity {
    kind: 'distance';
    calibration: {
        mode: 'ratio';
        mountHeightM: number;
        occupiedRatio: number;
    };
}

export interface ParkingDistanceThresholdSource extends ParkingSourceIdentity {
    kind: 'distance';
    calibration: {mode: 'threshold'; occupiedBelowM: number};
}

export interface ParkingBooleanSource extends ParkingSourceIdentity {
    kind: 'boolean';
    occupiedWhen: boolean;
}

export type ParkingOccupancySource =
    | ParkingDistanceRatioSource
    | ParkingDistanceThresholdSource
    | ParkingBooleanSource;

export interface ParkingBooleanSafetySource extends ParkingSourceIdentity {
    kind: 'smoke' | 'flood';
    alarmWhen: boolean;
}

export interface ParkingGasSafetySource extends ParkingSourceIdentity {
    kind: 'gas';
}

export type ParkingSafetySource =
    | ParkingBooleanSafetySource
    | ParkingGasSafetySource;

export interface ParkingOperationalPolicy {
    id: string;
    locationId: number;
    freshnessSec: number;
    sources: ParkingOccupancySource[];
    safetySources?: ParkingSafetySource[];
}

export interface IrrigationSchedule {
    hour: number;
    minute: number;
}

export interface IrrigationValveSource {
    deviceId: string;
    channel: number;
    kind: string;
}

export interface IrrigationSkipSource extends IrrigationValveSource {
    source?: string;
    threshold: number;
}

export interface IrrigationPolicy {
    id: string;
    locationId?: number;
    freshnessSec: number;
    graceSec: number;
    schedules: IrrigationSchedule[];
    valve: IrrigationValveSource;
    soil?: IrrigationSkipSource;
    rain?: IrrigationSkipSource;
}

export const IRRIGATION_VERDICT_STATUSES = [
    'config_missing',
    'data_missing',
    'stale',
    'scheduled',
    'completed',
    'skipped_by_policy',
    'missed'
] as const;
export type IrrigationVerdictStatus =
    (typeof IRRIGATION_VERDICT_STATUSES)[number];

export interface IrrigationVerdict {
    policyId: string;
    status: IrrigationVerdictStatus;
    dueAt: string | null;
    completedAt: string | null;
    skipReason: 'soil_wet' | 'rain' | null;
}

export interface PvGenerationSource {
    id: string;
    deviceId: string;
    channel: number;
    tag: string;
}

export interface PvHealthPolicy {
    id: string;
    locationId?: number;
    freshnessSec: number;
    periodHours: number;
    minComparableSources: number;
    attentionFraction: number;
    sources: PvGenerationSource[];
}

export const PV_HEALTH_STATUSES = [
    'config_missing',
    'data_missing',
    'stale',
    'healthy',
    'attention'
] as const;
export type PvHealthStatus = (typeof PV_HEALTH_STATUSES)[number];

export interface PvHealthVerdict {
    policyId: string;
    status: PvHealthStatus;
    comparableSources: number;
    attentionSources: string[];
}

export interface OperationalCoverage {
    configuredSources: number;
    observedSources: number;
    freshSources: number;
}

export interface RefrigerationPeerEnergyCoverage extends OperationalCoverage {
    ratedSources: number;
}

export interface RefrigerationPeerEnergySourceVerdict {
    sourceId: string;
    deviceId: string;
    peerGroupId: string;
    energyKwh: number | null;
    peerMedianKwh: number | null;
    peerCount: number;
    driftPct: number | null;
    status: Exclude<RefrigerationPeerEnergyStatus, 'config_missing'>;
    unratedReason: RefrigerationPeerEnergyUnratedReason | null;
}

export interface RefrigerationPeerHealth {
    policyId: string;
    status: RefrigerationPeerEnergyStatus;
    thresholdPct: number | null;
    from: string | null;
    to: string | null;
    coverage: RefrigerationPeerEnergyCoverage;
    sources: RefrigerationPeerEnergySourceVerdict[];
}

export interface ParkingSpotVerdict {
    id: string;
    customDeviceId: string;
    roleKey: string;
    status: ParkingSpotStatus;
    occupied: boolean | null;
    observedAt: string | null;
}

export interface ParkingSafetySourceVerdict {
    id: string;
    customDeviceId: string;
    roleKey: string;
    status: Exclude<ParkingSafetyStatus, 'config_missing'>;
    alarm: boolean | null;
    observedAt: string | null;
}

export interface ParkingSafetyKindVerdict {
    status: ParkingSafetyStatus;
    coverage: OperationalCoverage;
    alarm: boolean | null;
    sources: ParkingSafetySourceVerdict[];
}

export interface ParkingSafetyVerdict {
    smoke: ParkingSafetyKindVerdict;
    flood: ParkingSafetyKindVerdict;
    gas: ParkingSafetyKindVerdict;
}

export interface ParkingOperationalVerdict {
    policyId: string;
    status: ParkingOccupancyStatus;
    coverage: OperationalCoverage;
    occupied: number;
    available: number;
    unavailable: number;
    occupancyPercent: number | null;
    spots: ParkingSpotVerdict[];
    safety: ParkingSafetyVerdict;
}

export interface ItaliaNightFlowSource {
    readonly deviceId: string;
    readonly channel: number;
    readonly tag: string;
}

export interface ItaliaHotWaterBlockPolicy {
    readonly blockId: string;
    readonly deviceId: string;
    readonly kind: string;
    readonly source: string;
    readonly channel: number;
    readonly limitC: number;
}

export const ITALIA_POOL_REGISTER_ENTRY_IDS = [
    'freeChlorine',
    'combinedChlorine',
    'temperature',
    'ph',
    'makeUpWaterMeter',
    'disinfectant',
    'samplingDate',
    'bathers'
] as const;
export type ItaliaPoolRegisterEntryId =
    (typeof ITALIA_POOL_REGISTER_ENTRY_IDS)[number];
export const ITALIA_POOL_BAND_ENTRY_IDS = [
    'freeChlorine',
    'combinedChlorine',
    'temperature',
    'ph'
] as const;
export type ItaliaPoolBandEntryId = (typeof ITALIA_POOL_BAND_ENTRY_IDS)[number];

export interface ItaliaPoolChemistryBand {
    readonly entry: ItaliaPoolBandEntryId;
    readonly label: string;
    readonly min: number | null;
    readonly max: number | null;
    readonly unit: string;
}

export interface ItaliaPoolRegisterSensorSource {
    readonly entry: 'temperature' | 'makeUpWaterMeter';
    readonly deviceId: string;
    readonly kind: string;
    readonly source: string;
    readonly channel: number;
}

export interface ItaliaPoolChemistryPolicy {
    readonly poolId: string;
    readonly siteId: number;
    readonly timeZone: string;
    readonly seasonOpenMonthDay: string;
    readonly seasonCloseMonthDay: string;
    readonly bands: readonly ItaliaPoolChemistryBand[];
    readonly sources: readonly ItaliaPoolRegisterSensorSource[];
}

export interface ItaliaPoolRegisterWrite {
    readonly poolId: string;
    readonly siteId: number;
    readonly date: string;
    readonly entry: ItaliaPoolRegisterEntryId;
    readonly value: number | string;
}

export interface ItaliaPoolRegisterAcceptedWrite {
    readonly at: string;
    readonly username: string | null;
}

export interface ItaliaPoolRegisterStoredEntry extends ItaliaPoolRegisterWrite {
    readonly source: 'entered';
    readonly acceptedWrite: ItaliaPoolRegisterAcceptedWrite;
}

export interface ItaliaPoolRegisterEntryVerdict {
    readonly entry: ItaliaPoolRegisterEntryId;
    readonly status: 'present' | 'owed';
    readonly source: 'measured' | 'entered';
    readonly value: number | string | null;
    readonly band: ItaliaPoolChemistryBand | null;
    readonly compliance: 'within' | 'below' | 'above' | null;
    readonly acceptedWrite: ItaliaPoolRegisterAcceptedWrite | null;
}

export interface ItaliaPoolRegisterVerdict {
    readonly poolId: string;
    readonly siteId: number;
    readonly date: string;
    readonly status: 'config_missing' | 'configured';
    readonly poolOpen: boolean | null;
    readonly complete: boolean;
    readonly presentCount: number;
    readonly requiredCount: number;
    readonly entries: readonly ItaliaPoolRegisterEntryVerdict[];
}

export interface ItaliaHotWaterPolicy {
    readonly siteId: number;
    readonly timeZone: string;
    readonly freshnessSeconds: number;
    readonly maxGapMinutes: number;
    readonly holdMinutes: number;
    readonly blocks: readonly ItaliaHotWaterBlockPolicy[];
}

export interface ItaliaNightFlowZone {
    readonly zoneId: number;
    readonly sources: readonly ItaliaNightFlowSource[];
}

export interface ItaliaNightFlowPolicy {
    readonly siteId: number;
    readonly timeZone: string;
    readonly seasonOpenMonthDay: string;
    readonly seasonCloseMonthDay: string;
    readonly quietStartHour: number;
    readonly quietEndHour: number;
    readonly sustainedMinutes: number;
    readonly minimumBaselineSamples: number;
    readonly madMultiplier: number;
    readonly minimumExcessM3h: number;
    readonly zones: readonly ItaliaNightFlowZone[];
}

export interface ItaliaPitchPolicy {
    readonly pitchId: number;
    readonly deviceId: string;
    readonly component: 'switch';
    readonly channel: number;
    readonly ratedAmps: number;
    readonly warningFraction: number;
    readonly overloadFraction: number;
    readonly disconnectAfterSeconds: number;
    readonly freshnessSeconds: number;
}

export interface ItaliaSitePowerPolicy {
    readonly siteId: number;
    readonly meterId: number;
    readonly contractedKw: number;
    readonly availableMarginFraction: number;
    readonly warningFraction: number;
    readonly disconnectAfterSeconds: number;
    readonly freshnessSeconds: number;
}

export interface ItaliaBreakerTripPolicy {
    readonly pitchId: number;
    readonly logicalDeviceId: number;
    readonly component: string;
    readonly counterField: string;
    readonly windowDays: number;
}

export interface OperationalPolicies {
    refrigeration: RefrigerationPeerPolicy[];
    coldChain: ColdChainRecordPolicy[];
    parking: ParkingOperationalPolicy[];
    irrigation: IrrigationPolicy[];
    pv: PvHealthPolicy[];
    italiaPoolChemistry: ItaliaPoolChemistryPolicy[];
    italiaHotWater: ItaliaHotWaterPolicy[];
    italiaNightFlow: ItaliaNightFlowPolicy[];
    italiaPitch: ItaliaPitchPolicy[];
    italiaSitePower: ItaliaSitePowerPolicy[];
    italiaBreakerTrips: ItaliaBreakerTripPolicy[];
}

const POLICY_ID_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 120,
    pattern: '^[A-Za-z0-9._-]+$'
};
const CHANNEL_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 240,
    pattern: '^[A-Za-z0-9:_-]+(?:\\.[A-Za-z0-9:_-]+)*$'
};
const CUSTOM_DEVICE_ROLE_SCHEMA: JsonSchema = {
    type: 'string',
    minLength: 1,
    maxLength: 80,
    pattern: '^[a-z][a-z0-9_]*$'
};
const REFRIGERATION_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'deviceId', 'channel', 'tag', 'peerGroupIds'],
    properties: {
        id: POLICY_ID_SCHEMA,
        deviceId: SHELLY_ID_SCHEMA,
        channel: {type: 'integer', minimum: 0, maximum: 1000},
        tag: {type: 'string', const: 'total_act_energy'},
        peerGroupIds: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: CHANNEL_SCHEMA
        }
    }
};
const PARKING_DISTANCE_RATIO_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'customDeviceId', 'roleKey', 'kind', 'calibration'],
    properties: {
        id: POLICY_ID_SCHEMA,
        customDeviceId: SHELLY_ID_SCHEMA,
        roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
        kind: {type: 'string', const: 'distance'},
        calibration: {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'mountHeightM', 'occupiedRatio'],
            properties: {
                mode: {type: 'string', const: 'ratio'},
                mountHeightM: {type: 'number', exclusiveMinimum: 0},
                occupiedRatio: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 1
                }
            }
        }
    }
};
const PARKING_DISTANCE_THRESHOLD_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'customDeviceId', 'roleKey', 'kind', 'calibration'],
    properties: {
        id: POLICY_ID_SCHEMA,
        customDeviceId: SHELLY_ID_SCHEMA,
        roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
        kind: {type: 'string', const: 'distance'},
        calibration: {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'occupiedBelowM'],
            properties: {
                mode: {type: 'string', const: 'threshold'},
                occupiedBelowM: {type: 'number', exclusiveMinimum: 0}
            }
        }
    }
};
const PARKING_BOOLEAN_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'customDeviceId', 'roleKey', 'kind', 'occupiedWhen'],
    properties: {
        id: POLICY_ID_SCHEMA,
        customDeviceId: SHELLY_ID_SCHEMA,
        roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
        kind: {type: 'string', const: 'boolean'},
        occupiedWhen: {type: 'boolean'}
    }
};
const PARKING_SOURCE_SCHEMA: JsonSchema = {
    oneOf: [
        PARKING_DISTANCE_RATIO_SOURCE_SCHEMA,
        PARKING_DISTANCE_THRESHOLD_SOURCE_SCHEMA,
        PARKING_BOOLEAN_SOURCE_SCHEMA
    ]
};
const PARKING_BOOLEAN_SAFETY_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'customDeviceId', 'roleKey', 'kind', 'alarmWhen'],
    properties: {
        id: POLICY_ID_SCHEMA,
        customDeviceId: SHELLY_ID_SCHEMA,
        roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
        kind: {type: 'string', enum: ['smoke', 'flood']},
        alarmWhen: {type: 'boolean'}
    }
};
const PARKING_GAS_SAFETY_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'customDeviceId', 'roleKey', 'kind'],
    properties: {
        id: POLICY_ID_SCHEMA,
        customDeviceId: SHELLY_ID_SCHEMA,
        roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
        kind: {type: 'string', const: 'gas'}
    }
};
const PARKING_SAFETY_SOURCE_SCHEMA: JsonSchema = {
    oneOf: [
        PARKING_BOOLEAN_SAFETY_SOURCE_SCHEMA,
        PARKING_GAS_SAFETY_SOURCE_SCHEMA
    ]
};
const EVENT_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId', 'channel', 'kind'],
    properties: {
        deviceId: SHELLY_ID_SCHEMA,
        channel: {type: 'integer', minimum: 0, maximum: 1000},
        kind: {type: 'string', minLength: 1, maxLength: 120}
    }
};
const SKIP_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId', 'channel', 'kind', 'threshold'],
    properties: {
        ...EVENT_SOURCE_SCHEMA.properties,
        source: {type: 'string', minLength: 1, maxLength: 120},
        threshold: {type: 'number'}
    }
};
const IRRIGATION_SCHEDULE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['hour', 'minute'],
    properties: {
        hour: {type: 'integer', minimum: 0, maximum: 23},
        minute: {type: 'integer', minimum: 0, maximum: 59}
    }
};
const PV_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'deviceId', 'channel', 'tag'],
    properties: {
        id: POLICY_ID_SCHEMA,
        deviceId: SHELLY_ID_SCHEMA,
        channel: {type: 'integer', minimum: 0, maximum: 1000},
        tag: {
            type: 'string',
            enum: ['total_act_energy', 'total_act_ret_energy']
        }
    }
};
const COVERAGE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['configuredSources', 'observedSources', 'freshSources'],
    properties: {
        configuredSources: {type: 'integer', minimum: 0},
        observedSources: {type: 'integer', minimum: 0},
        freshSources: {type: 'integer', minimum: 0}
    }
};

const REFRIGERATION_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: ['id', 'freshnessSec', 'thresholdPct', 'minPeerCount', 'sources'],
    properties: {
        id: POLICY_ID_SCHEMA,
        locationId: {type: 'integer', minimum: 1},
        freshnessSec: {type: 'integer', minimum: 900, maximum: 86_400},
        thresholdPct: {type: 'number', exclusiveMinimum: 0, maximum: 10_000},
        minPeerCount: {
            type: 'integer',
            minimum: 2,
            maximum: OPERATIONAL_POLICY_MAX_SOURCES
        },
        sources: {
            type: 'array',
            minItems: 2,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: REFRIGERATION_SOURCE_SCHEMA
        }
    }
};

const COLD_CHAIN_RECORD_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'id',
        'deviceId',
        'kind',
        'source',
        'channel',
        'evidenceRequired',
        'maxTemperatureC',
        'limitBasis'
    ],
    properties: {
        id: POLICY_ID_SCHEMA,
        deviceId: SHELLY_ID_SCHEMA,
        kind: {type: 'string', minLength: 1, maxLength: 120},
        source: {type: 'string', minLength: 1, maxLength: 120},
        channel: {type: 'integer', minimum: 0, maximum: 1000},
        evidenceRequired: {type: 'boolean'},
        maxTemperatureC: {
            type: ['number', 'null'],
            minimum: -100,
            maximum: 200
        },
        limitBasis: {
            type: ['string', 'null'],
            enum: ['statutory', 'industry_practice', 'custom', null]
        }
    }
};

const COLD_CHAIN_RECORD_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'id',
        'locationId',
        'timeZone',
        'freshnessSeconds',
        'deadlineHour',
        'retentionDays',
        'sources'
    ],
    properties: {
        id: POLICY_ID_SCHEMA,
        locationId: {type: 'integer', minimum: 1},
        timeZone: {type: 'string', minLength: 1, maxLength: 120},
        freshnessSeconds: {type: 'integer', minimum: 60, maximum: 86_400},
        deadlineHour: {type: 'integer', minimum: 0, maximum: 23},
        retentionDays: {type: 'integer', minimum: 1, maximum: 3660},
        sources: {
            type: 'array',
            minItems: 1,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: COLD_CHAIN_RECORD_SOURCE_SCHEMA
        }
    }
};

const PARKING_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    description: `At most ${OPERATIONAL_POLICY_MAX_SOURCES} sources across occupancy and safety source lists.`,
    additionalProperties: false,
    required: ['id', 'locationId', 'freshnessSec', 'sources'],
    properties: {
        id: POLICY_ID_SCHEMA,
        locationId: {type: 'integer', minimum: 1},
        freshnessSec: {type: 'integer', minimum: 1, maximum: 86_400},
        sources: {
            type: 'array',
            minItems: 1,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: PARKING_SOURCE_SCHEMA
        },
        safetySources: {
            type: 'array',
            minItems: 1,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: PARKING_SAFETY_SOURCE_SCHEMA
        }
    }
};
const IRRIGATION_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: ['id', 'freshnessSec', 'graceSec', 'schedules', 'valve'],
    properties: {
        id: POLICY_ID_SCHEMA,
        locationId: {type: 'integer', minimum: 1},
        freshnessSec: {type: 'integer', minimum: 1, maximum: 86_400},
        graceSec: {type: 'integer', minimum: 1, maximum: 86_400},
        schedules: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            items: IRRIGATION_SCHEDULE_SCHEMA
        },
        valve: EVENT_SOURCE_SCHEMA,
        soil: SKIP_SOURCE_SCHEMA,
        rain: SKIP_SOURCE_SCHEMA
    }
};
const PV_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'id',
        'freshnessSec',
        'periodHours',
        'minComparableSources',
        'attentionFraction',
        'sources'
    ],
    properties: {
        id: POLICY_ID_SCHEMA,
        locationId: {type: 'integer', minimum: 1},
        freshnessSec: {type: 'integer', minimum: 1, maximum: 604_800},
        periodHours: {type: 'integer', minimum: 1, maximum: 744},
        minComparableSources: {type: 'integer', minimum: 2, maximum: 1000},
        attentionFraction: {type: 'number', exclusiveMinimum: 0, maximum: 1},
        sources: {
            type: 'array',
            minItems: 2,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: PV_SOURCE_SCHEMA
        }
    }
};
const ITALIA_HOT_WATER_BLOCK_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['blockId', 'deviceId', 'kind', 'source', 'channel', 'limitC'],
    properties: {
        blockId: POLICY_ID_SCHEMA,
        deviceId: SHELLY_ID_SCHEMA,
        kind: {type: 'string', minLength: 1, maxLength: 120},
        source: {type: 'string', minLength: 1, maxLength: 120},
        channel: {type: 'integer', minimum: 0, maximum: 1000},
        limitC: {type: 'number', minimum: -100, maximum: 200}
    }
};
const ITALIA_HOT_WATER_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'siteId',
        'timeZone',
        'freshnessSeconds',
        'maxGapMinutes',
        'holdMinutes',
        'blocks'
    ],
    properties: {
        siteId: {type: 'integer', minimum: 1},
        timeZone: {type: 'string', minLength: 1, maxLength: 120},
        freshnessSeconds: {type: 'integer', minimum: 60, maximum: 86_400},
        maxGapMinutes: {type: 'integer', minimum: 1, maximum: 1_440},
        holdMinutes: {type: 'integer', minimum: 1, maximum: 1_440},
        blocks: {
            type: 'array',
            minItems: 1,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: ITALIA_HOT_WATER_BLOCK_SCHEMA
        }
    }
};
const ITALIA_POOL_BAND_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['entry', 'label', 'min', 'max', 'unit'],
    properties: {
        entry: {type: 'string', enum: [...ITALIA_POOL_BAND_ENTRY_IDS]},
        label: {type: 'string', minLength: 1, maxLength: 240},
        min: {type: ['number', 'null']},
        max: {type: ['number', 'null']},
        unit: {type: 'string', maxLength: 30}
    }
};
const ITALIA_POOL_SENSOR_SOURCE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['entry', 'deviceId', 'kind', 'source', 'channel'],
    properties: {
        entry: {
            type: 'string',
            enum: ['temperature', 'makeUpWaterMeter']
        },
        deviceId: SHELLY_ID_SCHEMA,
        kind: {type: 'string', minLength: 1, maxLength: 120},
        source: {type: 'string', minLength: 1, maxLength: 120},
        channel: {type: 'integer', minimum: 0, maximum: 1000}
    }
};
const ITALIA_POOL_CHEMISTRY_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'poolId',
        'siteId',
        'timeZone',
        'seasonOpenMonthDay',
        'seasonCloseMonthDay',
        'bands',
        'sources'
    ],
    properties: {
        poolId: POLICY_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1},
        timeZone: {type: 'string', minLength: 1, maxLength: 120},
        seasonOpenMonthDay: {
            type: 'string',
            pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$',
            examples: ['04-01']
        },
        seasonCloseMonthDay: {
            type: 'string',
            pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$',
            examples: ['10-31']
        },
        bands: {
            type: 'array',
            minItems: 1,
            maxItems: ITALIA_POOL_BAND_ENTRY_IDS.length,
            items: ITALIA_POOL_BAND_SCHEMA
        },
        sources: {
            type: 'array',
            maxItems: 2,
            items: ITALIA_POOL_SENSOR_SOURCE_SCHEMA
        }
    }
};
const ITALIA_POOL_REGISTER_VALUE_SCHEMA: JsonSchema = {
    oneOf: [{type: 'number'}, {type: 'string', minLength: 1, maxLength: 240}]
};
const ITALIA_POOL_REGISTER_WRITE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['poolId', 'siteId', 'date', 'entry', 'value'],
    properties: {
        poolId: POLICY_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1},
        date: {type: 'string', format: 'date'},
        entry: {type: 'string', enum: [...ITALIA_POOL_REGISTER_ENTRY_IDS]},
        value: ITALIA_POOL_REGISTER_VALUE_SCHEMA
    }
};
const ITALIA_NIGHT_ZONE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['zoneId', 'sources'],
    properties: {
        zoneId: {type: 'integer', minimum: 1},
        sources: {
            type: 'array',
            minItems: 1,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['deviceId', 'channel', 'tag'],
                properties: {
                    deviceId: SHELLY_ID_SCHEMA,
                    channel: {type: 'integer', minimum: 0, maximum: 1000},
                    tag: {type: 'string', const: 'volume_flow_m3h'}
                }
            }
        }
    }
};
const ITALIA_NIGHT_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    description: `At most ${OPERATIONAL_POLICY_MAX_SOURCES} sources in total across all zones.`,
    additionalProperties: false,
    required: [
        'siteId',
        'timeZone',
        'seasonOpenMonthDay',
        'seasonCloseMonthDay',
        'quietStartHour',
        'quietEndHour',
        'sustainedMinutes',
        'minimumBaselineSamples',
        'madMultiplier',
        'minimumExcessM3h',
        'zones'
    ],
    properties: {
        siteId: {type: 'integer', minimum: 1},
        timeZone: {type: 'string', minLength: 1, maxLength: 120},
        seasonOpenMonthDay: {
            type: 'string',
            pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$',
            examples: ['03-27']
        },
        seasonCloseMonthDay: {
            type: 'string',
            pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$',
            examples: ['11-02']
        },
        quietStartHour: {type: 'integer', minimum: 0, maximum: 23},
        quietEndHour: {type: 'integer', minimum: 1, maximum: 24},
        sustainedMinutes: {type: 'integer', minimum: 15, maximum: 1440},
        minimumBaselineSamples: {type: 'integer', minimum: 1, maximum: 366},
        madMultiplier: {type: 'number', minimum: 0},
        minimumExcessM3h: {type: 'number', minimum: 0},
        zones: {
            type: 'array',
            minItems: 1,
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: ITALIA_NIGHT_ZONE_SCHEMA
        }
    }
};
const ITALIA_PITCH_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'pitchId',
        'deviceId',
        'component',
        'channel',
        'ratedAmps',
        'warningFraction',
        'overloadFraction',
        'disconnectAfterSeconds',
        'freshnessSeconds'
    ],
    properties: {
        pitchId: {type: 'integer', minimum: 1},
        deviceId: SHELLY_ID_SCHEMA,
        component: {type: 'string', const: 'switch'},
        channel: {type: 'integer', minimum: 0, maximum: 1000},
        ratedAmps: {type: 'number', exclusiveMinimum: 0},
        warningFraction: {
            type: 'number',
            exclusiveMinimum: 0,
            maximum: 1
        },
        overloadFraction: {type: 'number', minimum: 1},
        disconnectAfterSeconds: {type: 'integer', minimum: 1, maximum: 86400},
        freshnessSeconds: {type: 'integer', minimum: 1, maximum: 86400}
    }
};
const ITALIA_SITE_POWER_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'siteId',
        'meterId',
        'contractedKw',
        'availableMarginFraction',
        'warningFraction',
        'disconnectAfterSeconds',
        'freshnessSeconds'
    ],
    properties: {
        siteId: {type: 'integer', minimum: 1},
        meterId: {type: 'integer', minimum: 1},
        contractedKw: {type: 'number', exclusiveMinimum: 0},
        availableMarginFraction: {
            type: 'number',
            minimum: 0,
            maximum: 1
        },
        warningFraction: {
            type: 'number',
            exclusiveMinimum: 0,
            maximum: 1
        },
        disconnectAfterSeconds: {
            type: 'integer',
            minimum: 1,
            maximum: 86400
        },
        freshnessSeconds: {type: 'integer', minimum: 1, maximum: 86400}
    }
};
const ITALIA_BREAKER_TRIP_POLICY_SCHEMA: JsonSchema = {
    type: 'object',
    maxBytes: METADATA_MAX_BYTES,
    additionalProperties: false,
    required: [
        'pitchId',
        'logicalDeviceId',
        'component',
        'counterField',
        'windowDays'
    ],
    properties: {
        pitchId: {type: 'integer', minimum: 1},
        logicalDeviceId: {type: 'integer', minimum: 1},
        component: CHANNEL_SCHEMA,
        counterField: CHANNEL_SCHEMA,
        windowDays: {type: 'integer', minimum: 1, maximum: 30}
    }
};

export const OPERATIONS_GET_REFRIGERATION_PEER_HEALTH_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId', 'from', 'to'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policyId: POLICY_ID_SCHEMA,
        from: {type: 'string', format: 'date-time'},
        to: {type: 'string', format: 'date-time'}
    }
};
export const OPERATIONS_GET_POLICIES_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {organizationId: ORG_ID_SCHEMA}
};
export const OPERATIONS_GET_POLICY_REGISTRY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {organizationId: ORG_ID_SCHEMA}
};
export const OPERATIONS_GET_POLICY_SELECTOR_CATALOG_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['family'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        family: {type: 'string', enum: [...OPERATIONAL_POLICY_FAMILIES]},
        locationId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_SET_POLICY_PARAMS: JsonSchema = {
    oneOf: OPERATIONAL_POLICY_FAMILIES.map((family) => ({
        type: 'object',
        additionalProperties: false,
        required: ['family', 'policy'],
        properties: {
            organizationId: ORG_ID_SCHEMA,
            family: {type: 'string', const: family},
            policy: policySchemaForFamily(family)
        }
    }))
};
export const OPERATIONS_DELETE_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['family', 'policyId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        family: {type: 'string', enum: [...OPERATIONAL_POLICY_FAMILIES]},
        policyId: POLICY_ID_SCHEMA
    }
};
export const OPERATIONS_GET_PARKING_OPERATIONAL_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['locationId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        locationId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_SET_REFRIGERATION_PEER_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: REFRIGERATION_POLICY_SCHEMA
    }
};
export const OPERATIONS_GET_COLD_CHAIN_RECORD_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId'],
    properties: {organizationId: ORG_ID_SCHEMA, policyId: POLICY_ID_SCHEMA}
};
export const OPERATIONS_SET_COLD_CHAIN_RECORD_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: COLD_CHAIN_RECORD_POLICY_SCHEMA
    }
};
export const OPERATIONS_SET_PARKING_OPERATIONAL_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {organizationId: ORG_ID_SCHEMA, policy: PARKING_POLICY_SCHEMA}
};
export const OPERATIONS_GET_IRRIGATION_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId'],
    properties: {organizationId: ORG_ID_SCHEMA, policyId: POLICY_ID_SCHEMA}
};
export const OPERATIONS_SET_IRRIGATION_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: IRRIGATION_POLICY_SCHEMA
    }
};
export const OPERATIONS_GET_PV_HEALTH_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId'],
    properties: {organizationId: ORG_ID_SCHEMA, policyId: POLICY_ID_SCHEMA}
};
export const OPERATIONS_SET_PV_HEALTH_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {organizationId: ORG_ID_SCHEMA, policy: PV_POLICY_SCHEMA}
};
export const OPERATIONS_GET_ITALIA_HOT_WATER_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_GET_ITALIA_POOL_REGISTER_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId', 'poolId', 'from', 'to'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1},
        poolId: POLICY_ID_SCHEMA,
        from: {type: 'string', format: 'date'},
        to: {type: 'string', format: 'date'}
    }
};
export const OPERATIONS_SET_ITALIA_POOL_CHEMISTRY_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: ITALIA_POOL_CHEMISTRY_POLICY_SCHEMA
    }
};
export const OPERATIONS_SET_ITALIA_POOL_REGISTER_ENTRY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['entry'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        entry: ITALIA_POOL_REGISTER_WRITE_SCHEMA
    }
};
export const OPERATIONS_DELETE_ITALIA_POOL_REGISTER_ENTRY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId', 'poolId', 'date', 'entry'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1},
        poolId: POLICY_ID_SCHEMA,
        date: {type: 'string', format: 'date'},
        entry: {type: 'string', enum: [...ITALIA_POOL_REGISTER_ENTRY_IDS]}
    }
};
export const OPERATIONS_GET_ITALIA_REOPENING_FLUSH_VERDICT_PARAMS: JsonSchema =
    {
        type: 'object',
        additionalProperties: false,
        required: ['siteId', 'from', 'to'],
        properties: {
            organizationId: ORG_ID_SCHEMA,
            siteId: {type: 'integer', minimum: 1},
            from: {type: 'string', format: 'date-time'},
            to: {type: 'string', format: 'date-time'}
        }
    };
export const OPERATIONS_SET_ITALIA_HOT_WATER_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: ITALIA_HOT_WATER_POLICY_SCHEMA
    }
};
export const OPERATIONS_GET_ITALIA_NIGHT_FLOW_VERDICTS_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_SET_ITALIA_NIGHT_FLOW_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: ITALIA_NIGHT_POLICY_SCHEMA
    }
};
export const OPERATIONS_GET_ITALIA_PITCH_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['pitchId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        pitchId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_SET_ITALIA_PITCH_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: ITALIA_PITCH_POLICY_SCHEMA
    }
};
export const OPERATIONS_GET_ITALIA_SITE_POWER_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_SET_ITALIA_SITE_POWER_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: ITALIA_SITE_POWER_POLICY_SCHEMA
    }
};
export const OPERATIONS_GET_ITALIA_BREAKER_TRIP_VERDICT_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['pitchId'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        pitchId: {type: 'integer', minimum: 1}
    }
};
export const OPERATIONS_SET_ITALIA_BREAKER_TRIP_POLICY_PARAMS: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policy'],
    properties: {
        organizationId: ORG_ID_SCHEMA,
        policy: ITALIA_BREAKER_TRIP_POLICY_SCHEMA
    }
};

const REFRIGERATION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'policyId',
        'status',
        'thresholdPct',
        'from',
        'to',
        'coverage',
        'sources'
    ],
    properties: {
        policyId: POLICY_ID_SCHEMA,
        status: {
            type: 'string',
            enum: [...REFRIGERATION_PEER_ENERGY_STATUSES]
        },
        thresholdPct: {type: ['number', 'null'], exclusiveMinimum: 0},
        from: {type: ['string', 'null'], format: 'date-time'},
        to: {type: ['string', 'null'], format: 'date-time'},
        coverage: {
            type: 'object',
            additionalProperties: false,
            required: [
                'configuredSources',
                'observedSources',
                'freshSources',
                'ratedSources'
            ],
            properties: {
                ...COVERAGE_SCHEMA.properties,
                ratedSources: {type: 'integer', minimum: 0}
            }
        },
        sources: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'sourceId',
                    'deviceId',
                    'peerGroupId',
                    'energyKwh',
                    'peerMedianKwh',
                    'peerCount',
                    'driftPct',
                    'status',
                    'unratedReason'
                ],
                properties: {
                    sourceId: POLICY_ID_SCHEMA,
                    deviceId: SHELLY_ID_SCHEMA,
                    peerGroupId: CHANNEL_SCHEMA,
                    energyKwh: {type: ['number', 'null'], minimum: 0},
                    peerMedianKwh: {type: ['number', 'null'], minimum: 0},
                    peerCount: {type: 'integer', minimum: 0},
                    driftPct: {type: ['number', 'null']},
                    status: {
                        type: 'string',
                        enum: [
                            'data_missing',
                            'stale',
                            'unrated',
                            'healthy',
                            'attention'
                        ]
                    },
                    unratedReason: {
                        type: ['string', 'null'],
                        enum: ['insufficient_peers', 'zero_median', null]
                    }
                }
            }
        }
    }
};

const COLD_CHAIN_RECORD_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'policyId',
        'date',
        'status',
        'complete',
        'overdue',
        'coverage',
        'sources'
    ],
    properties: {
        policyId: POLICY_ID_SCHEMA,
        date: {type: ['string', 'null'], format: 'date'},
        status: {type: 'string', enum: [...COLD_CHAIN_RECORD_STATUSES]},
        complete: {type: 'boolean'},
        overdue: {type: 'boolean'},
        coverage: COVERAGE_SCHEMA,
        sources: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'sourceId',
                    'deviceId',
                    'status',
                    'observedAt',
                    'temperatureC',
                    'maxTemperatureC',
                    'limitBasis',
                    'evidenceRequired',
                    'loggedToday',
                    'neverReported',
                    'silenceHours'
                ],
                properties: {
                    sourceId: POLICY_ID_SCHEMA,
                    deviceId: SHELLY_ID_SCHEMA,
                    status: {
                        type: 'string',
                        enum: [...COLD_CHAIN_CASE_STATUSES]
                    },
                    observedAt: {type: ['string', 'null'], format: 'date-time'},
                    temperatureC: {type: ['number', 'null']},
                    maxTemperatureC: {type: ['number', 'null']},
                    limitBasis: {
                        type: ['string', 'null'],
                        enum: ['statutory', 'industry_practice', 'custom', null]
                    },
                    evidenceRequired: {type: 'boolean'},
                    loggedToday: {type: 'boolean'},
                    neverReported: {type: ['boolean', 'null']},
                    silenceHours: {type: ['number', 'null'], minimum: 0}
                }
            }
        }
    }
};

function parkingSafetyKindResponseSchema(): JsonSchema {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'coverage', 'alarm', 'sources'],
        properties: {
            status: {type: 'string', enum: [...PARKING_SAFETY_STATUSES]},
            coverage: COVERAGE_SCHEMA,
            alarm: {type: ['boolean', 'null']},
            sources: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'id',
                        'customDeviceId',
                        'roleKey',
                        'status',
                        'alarm',
                        'observedAt'
                    ],
                    properties: {
                        id: POLICY_ID_SCHEMA,
                        customDeviceId: SHELLY_ID_SCHEMA,
                        roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
                        status: {
                            type: 'string',
                            enum: ['data_missing', 'stale', 'clear', 'alarm']
                        },
                        alarm: {type: ['boolean', 'null']},
                        observedAt: {
                            type: ['string', 'null'],
                            format: 'date-time'
                        }
                    }
                }
            }
        }
    };
}

const PARKING_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'policyId',
        'status',
        'coverage',
        'occupied',
        'available',
        'unavailable',
        'occupancyPercent',
        'spots',
        'safety'
    ],
    properties: {
        policyId: POLICY_ID_SCHEMA,
        status: {type: 'string', enum: [...PARKING_OCCUPANCY_STATUSES]},
        coverage: COVERAGE_SCHEMA,
        occupied: {type: 'integer', minimum: 0},
        available: {type: 'integer', minimum: 0},
        unavailable: {type: 'integer', minimum: 0},
        occupancyPercent: {type: ['number', 'null'], minimum: 0, maximum: 100},
        spots: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'id',
                    'customDeviceId',
                    'roleKey',
                    'status',
                    'occupied',
                    'observedAt'
                ],
                properties: {
                    id: POLICY_ID_SCHEMA,
                    customDeviceId: SHELLY_ID_SCHEMA,
                    roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
                    status: {type: 'string', enum: [...PARKING_SPOT_STATUSES]},
                    occupied: {type: ['boolean', 'null']},
                    observedAt: {
                        type: ['string', 'null'],
                        format: 'date-time'
                    }
                }
            }
        },
        safety: {
            type: 'object',
            additionalProperties: false,
            required: ['smoke', 'flood', 'gas'],
            properties: {
                smoke: parkingSafetyKindResponseSchema(),
                flood: parkingSafetyKindResponseSchema(),
                gas: parkingSafetyKindResponseSchema()
            }
        }
    }
};
const IRRIGATION_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId', 'status', 'dueAt', 'completedAt', 'skipReason'],
    properties: {
        policyId: POLICY_ID_SCHEMA,
        status: {type: 'string', enum: [...IRRIGATION_VERDICT_STATUSES]},
        dueAt: {type: ['string', 'null'], format: 'date-time'},
        completedAt: {type: ['string', 'null'], format: 'date-time'},
        skipReason: {type: ['string', 'null'], enum: ['soil_wet', 'rain', null]}
    }
};
const PV_HEALTH_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['policyId', 'status', 'comparableSources', 'attentionSources'],
    properties: {
        policyId: POLICY_ID_SCHEMA,
        status: {type: 'string', enum: [...PV_HEALTH_STATUSES]},
        comparableSources: {type: 'integer', minimum: 0},
        attentionSources: {
            type: 'array',
            items: POLICY_ID_SCHEMA
        }
    }
};
const ITALIA_HOT_WATER_BLOCK_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'blockId',
        'deviceId',
        'status',
        'limitC',
        'currentC',
        'observedAt',
        'minimumC',
        'minutesBelowNow',
        'minutesBelowInPeriod',
        'samples'
    ],
    properties: {
        blockId: POLICY_ID_SCHEMA,
        deviceId: SHELLY_ID_SCHEMA,
        status: {
            type: 'string',
            enum: ['data_missing', 'stale', 'at_or_above_limit', 'below_limit']
        },
        limitC: {type: 'number', minimum: -100, maximum: 200},
        currentC: {type: ['number', 'null']},
        observedAt: {type: ['string', 'null'], format: 'date-time'},
        minimumC: {type: ['number', 'null']},
        minutesBelowNow: {type: ['number', 'null'], minimum: 0},
        minutesBelowInPeriod: {type: ['number', 'null'], minimum: 0},
        samples: {type: 'integer', minimum: 0}
    }
};
const ITALIA_POOL_ACCEPTED_WRITE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['at', 'username'],
    properties: {
        at: {type: 'string', format: 'date-time'},
        username: {type: ['string', 'null']}
    }
};
const ITALIA_POOL_REGISTER_ENTRY_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'entry',
        'status',
        'source',
        'value',
        'band',
        'compliance',
        'acceptedWrite'
    ],
    properties: {
        entry: {type: 'string', enum: [...ITALIA_POOL_REGISTER_ENTRY_IDS]},
        status: {type: 'string', enum: ['present', 'owed']},
        source: {type: 'string', enum: ['measured', 'entered']},
        value: {
            oneOf: [{type: 'number'}, {type: 'string'}, {type: 'null'}]
        },
        band: {oneOf: [ITALIA_POOL_BAND_SCHEMA, {type: 'null'}]},
        compliance: {
            type: ['string', 'null'],
            enum: ['within', 'below', 'above', null]
        },
        acceptedWrite: {
            oneOf: [ITALIA_POOL_ACCEPTED_WRITE_SCHEMA, {type: 'null'}]
        }
    }
};
const ITALIA_POOL_REGISTER_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'poolId',
        'siteId',
        'date',
        'status',
        'poolOpen',
        'complete',
        'presentCount',
        'requiredCount',
        'entries'
    ],
    properties: {
        poolId: POLICY_ID_SCHEMA,
        siteId: {type: 'integer', minimum: 1},
        date: {type: 'string', format: 'date'},
        status: {type: 'string', enum: ['config_missing', 'configured']},
        poolOpen: {type: ['boolean', 'null']},
        complete: {type: 'boolean'},
        presentCount: {type: 'integer', minimum: 0, maximum: 8},
        requiredCount: {type: 'integer', minimum: 0, maximum: 8},
        entries: {
            type: 'array',
            maxItems: ITALIA_POOL_REGISTER_ENTRY_IDS.length,
            items: ITALIA_POOL_REGISTER_ENTRY_VERDICT_SCHEMA
        }
    }
};
const ITALIA_POOL_REGISTER_STORED_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'poolId',
        'siteId',
        'date',
        'entry',
        'value',
        'source',
        'acceptedWrite'
    ],
    properties: {
        ...ITALIA_POOL_REGISTER_WRITE_SCHEMA.properties,
        source: {type: 'string', const: 'entered'},
        acceptedWrite: ITALIA_POOL_ACCEPTED_WRITE_SCHEMA
    }
};
const ITALIA_HOT_WATER_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId', 'status', 'from', 'to', 'blocks'],
    properties: {
        siteId: {type: 'integer', minimum: 1},
        status: {type: 'string', enum: ['config_missing', 'configured']},
        from: {type: ['string', 'null'], format: 'date-time'},
        to: {type: ['string', 'null'], format: 'date-time'},
        blocks: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: ITALIA_HOT_WATER_BLOCK_VERDICT_SCHEMA
        }
    }
};
const ITALIA_REOPENING_FLUSH_BLOCK_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'blockId',
        'deviceId',
        'status',
        'limitC',
        'holdMinutes',
        'heldMinutes',
        'reachedAt',
        'heldUntil',
        'peakC',
        'samples'
    ],
    properties: {
        blockId: POLICY_ID_SCHEMA,
        deviceId: SHELLY_ID_SCHEMA,
        status: {
            type: 'string',
            enum: ['data_missing', 'pending', 'reached', 'not_reached']
        },
        limitC: {type: 'number', minimum: -100, maximum: 200},
        holdMinutes: {type: 'integer', minimum: 1},
        heldMinutes: {type: ['number', 'null'], minimum: 0},
        reachedAt: {type: ['string', 'null'], format: 'date-time'},
        heldUntil: {type: ['string', 'null'], format: 'date-time'},
        peakC: {type: ['number', 'null']},
        samples: {type: 'integer', minimum: 0}
    }
};
const ITALIA_REOPENING_FLUSH_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['siteId', 'status', 'from', 'to', 'blocks'],
    properties: {
        siteId: {type: 'integer', minimum: 1},
        status: {type: 'string', enum: ['config_missing', 'configured']},
        from: {type: ['string', 'null'], format: 'date-time'},
        to: {type: ['string', 'null'], format: 'date-time'},
        blocks: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_SOURCES,
            items: ITALIA_REOPENING_FLUSH_BLOCK_VERDICT_SCHEMA
        }
    }
};
const ITALIA_NIGHT_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'zoneId',
        'status',
        'latestDay',
        'latestMinimumM3h',
        'baselineM3h',
        'excessM3h',
        'estimatedLitresPerDay',
        'baselineSamples'
    ],
    properties: {
        zoneId: {type: 'integer', minimum: 1},
        status: {
            type: 'string',
            enum: [
                'config_missing',
                'data_missing',
                'insufficient_baseline',
                'normal',
                'leak'
            ]
        },
        latestDay: {type: ['string', 'null']},
        latestMinimumM3h: {type: ['number', 'null']},
        baselineM3h: {type: ['number', 'null']},
        excessM3h: {type: ['number', 'null']},
        estimatedLitresPerDay: {type: ['number', 'null']},
        baselineSamples: {type: 'integer', minimum: 0}
    }
};
const ITALIA_PITCH_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['pitchId', 'status', 'amps', 'ratedAmps', 'usedFraction'],
    properties: {
        pitchId: {type: 'integer', minimum: 1},
        status: {
            type: 'string',
            enum: [
                'config_missing',
                'data_missing',
                'freshness_missing',
                'normal',
                'warning',
                'overload',
                'disconnect_risk'
            ]
        },
        amps: {type: ['number', 'null']},
        ratedAmps: {type: ['number', 'null']},
        usedFraction: {type: ['number', 'null']}
    }
};
const ITALIA_SITE_POWER_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'siteId',
        'status',
        'meterId',
        'observedAt',
        'drawKw',
        'contractedKw',
        'availableKw',
        'availableMarginFraction',
        'disconnectAfterSeconds',
        'contractedUsedFraction',
        'usedFraction',
        'remainingKw'
    ],
    properties: {
        siteId: {type: 'integer', minimum: 1},
        status: {
            type: 'string',
            enum: [
                'config_missing',
                'data_missing',
                'freshness_missing',
                'normal',
                'warning',
                'overload'
            ]
        },
        meterId: {type: ['integer', 'null'], minimum: 1},
        observedAt: {type: ['string', 'null'], format: 'date-time'},
        drawKw: {type: ['number', 'null']},
        contractedKw: {type: ['number', 'null']},
        availableKw: {type: ['number', 'null']},
        availableMarginFraction: {type: ['number', 'null'], minimum: 0},
        disconnectAfterSeconds: {type: ['integer', 'null'], minimum: 1},
        contractedUsedFraction: {type: ['number', 'null']},
        usedFraction: {type: ['number', 'null']},
        remainingKw: {type: ['number', 'null']}
    }
};
const ITALIA_BREAKER_TRIP_VERDICT_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'pitchId',
        'logicalDeviceId',
        'status',
        'trips',
        'readingsUsed',
        'from',
        'to'
    ],
    properties: {
        pitchId: {type: 'integer', minimum: 1},
        logicalDeviceId: {type: ['integer', 'null'], minimum: 1},
        status: {
            type: 'string',
            enum: [
                'config_missing',
                'no_readings',
                'one_reading',
                'counter_reset',
                'complete'
            ]
        },
        trips: {type: ['integer', 'null'], minimum: 0},
        readingsUsed: {type: 'integer', minimum: 0},
        from: {type: ['string', 'null'], format: 'date-time'},
        to: {type: ['string', 'null'], format: 'date-time'}
    }
};
const OPERATIONAL_POLICIES_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [...OPERATIONAL_POLICY_FAMILIES],
    properties: {
        refrigeration: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: REFRIGERATION_POLICY_SCHEMA
        },
        coldChain: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: COLD_CHAIN_RECORD_POLICY_SCHEMA
        },
        parking: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: PARKING_POLICY_SCHEMA
        },
        irrigation: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: IRRIGATION_POLICY_SCHEMA
        },
        pv: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: PV_POLICY_SCHEMA
        },
        italiaPoolChemistry: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: ITALIA_POOL_CHEMISTRY_POLICY_SCHEMA
        },
        italiaHotWater: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: ITALIA_HOT_WATER_POLICY_SCHEMA
        },
        italiaNightFlow: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: ITALIA_NIGHT_POLICY_SCHEMA
        },
        italiaPitch: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: ITALIA_PITCH_POLICY_SCHEMA
        },
        italiaSitePower: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: ITALIA_SITE_POWER_POLICY_SCHEMA
        },
        italiaBreakerTrips: {
            type: 'array',
            maxItems: OPERATIONAL_POLICY_MAX_COUNT,
            items: ITALIA_BREAKER_TRIP_POLICY_SCHEMA
        }
    }
};
const DELETE_POLICY_RESPONSE_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['deleted'],
    properties: {deleted: {type: 'boolean'}}
};
const OPERATIONAL_POLICY_REGISTRY_PERMISSION_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['component', 'operation'],
    properties: {
        component: {type: 'string', const: 'organizations'},
        operation: {type: 'string', enum: ['read', 'update']}
    }
};
const OPERATIONAL_POLICY_REGISTRY_ENTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'family',
        'label',
        'description',
        'scopes',
        'sourceSelectors',
        'selectorBindings',
        'storage',
        'evaluatorBlocks',
        'setMethod',
        'verdictMethod',
        'permissions',
        'resultStates',
        'policyIdField',
        'editableFields',
        'policySchema'
    ],
    properties: {
        family: {type: 'string', enum: [...OPERATIONAL_POLICY_FAMILIES]},
        label: {type: 'string', minLength: 1},
        description: {type: 'string', minLength: 1},
        scopes: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', enum: [...OPERATION_SCOPE_KINDS]}
        },
        sourceSelectors: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', enum: [...OPERATION_SOURCE_SELECTORS]}
        },
        selectorBindings: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'collection', 'apply'],
                properties: {
                    path: {type: 'string'},
                    collection: {
                        type: 'string',
                        enum: [
                            'locations',
                            'physicalSources',
                            'logicalMeters',
                            'logicalDevices',
                            'customDeviceRoles'
                        ]
                    },
                    sourceType: {
                        type: 'string',
                        enum: ['energy', 'numeric', 'event', 'switchCurrent']
                    },
                    locationRelation: {
                        type: 'string',
                        enum: ['selected', 'selected-or-parent']
                    },
                    locationKinds: {
                        type: 'array',
                        minItems: 1,
                        uniqueItems: true,
                        items: {type: 'string', minLength: 1}
                    },
                    apply: {
                        type: 'object',
                        additionalProperties: {type: 'string'}
                    }
                }
            }
        },
        storage: {type: 'string', enum: [...OPERATION_STORAGE_ADAPTERS]},
        evaluatorBlocks: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', enum: [...OPERATION_EVALUATOR_BLOCKS]}
        },
        setMethod: {type: 'string', minLength: 1},
        verdictMethod: {type: 'string', minLength: 1},
        permissions: {
            type: 'object',
            additionalProperties: false,
            required: ['read', 'write'],
            properties: {
                read: OPERATIONAL_POLICY_REGISTRY_PERMISSION_SCHEMA,
                write: OPERATIONAL_POLICY_REGISTRY_PERMISSION_SCHEMA
            }
        },
        resultStates: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', minLength: 1}
        },
        policyIdField: {
            type: 'string',
            enum: [...OPERATION_POLICY_IDENTIFIER_FIELDS]
        },
        editableFields: {
            type: 'array',
            minItems: 1,
            items: {type: 'string', minLength: 1}
        },
        policySchema: {type: 'object'}
    }
};
const OPERATIONAL_POLICY_REGISTRY_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
        operations: {
            type: 'array',
            minItems: OPERATIONAL_POLICY_FAMILIES.length,
            maxItems: OPERATIONAL_POLICY_FAMILIES.length,
            items: OPERATIONAL_POLICY_REGISTRY_ENTRY_SCHEMA
        }
    }
};
const OPERATIONAL_PHYSICAL_SOURCE_CHOICE_SCHEMA: JsonSchema = {
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            required: [
                'sourceType',
                'deviceId',
                'label',
                'locationId',
                'component',
                'channel',
                'tag'
            ],
            properties: {
                sourceType: {type: 'string', const: 'energy'},
                deviceId: SHELLY_ID_SCHEMA,
                label: {type: 'string', minLength: 1},
                locationId: {type: ['integer', 'null'], minimum: 1},
                component: {type: ['string', 'null'], minLength: 1},
                channel: {type: 'integer', minimum: 0},
                tag: {type: 'string', minLength: 1}
            }
        },
        {
            type: 'object',
            additionalProperties: false,
            required: [
                'sourceType',
                'deviceId',
                'label',
                'locationId',
                'kind',
                'source',
                'channel'
            ],
            properties: {
                sourceType: {type: 'string', enum: ['numeric', 'event']},
                deviceId: SHELLY_ID_SCHEMA,
                label: {type: 'string', minLength: 1},
                locationId: {type: ['integer', 'null'], minimum: 1},
                kind: {type: 'string', minLength: 1},
                source: {type: 'string', minLength: 1},
                channel: {type: 'integer', minimum: 0}
            }
        },
        {
            type: 'object',
            additionalProperties: false,
            required: [
                'sourceType',
                'deviceId',
                'label',
                'locationId',
                'component',
                'channel'
            ],
            properties: {
                sourceType: {type: 'string', const: 'switchCurrent'},
                deviceId: SHELLY_ID_SCHEMA,
                label: {type: 'string', minLength: 1},
                locationId: {type: ['integer', 'null'], minimum: 1},
                component: {type: 'string', const: 'switch'},
                channel: {type: 'integer', minimum: 0}
            }
        }
    ]
};
const OPERATIONAL_POLICY_SELECTOR_CATALOG_SCHEMA: JsonSchema = {
    type: 'object',
    additionalProperties: false,
    required: [
        'family',
        'locations',
        'physicalSources',
        'logicalMeters',
        'logicalDevices',
        'customDeviceRoles'
    ],
    properties: {
        family: {type: 'string', enum: [...OPERATIONAL_POLICY_FAMILIES]},
        locations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'id',
                    'name',
                    'kind',
                    'parentLocationId',
                    'timeZone'
                ],
                properties: {
                    id: {type: 'integer', minimum: 1},
                    name: {type: 'string', minLength: 1},
                    kind: {type: 'string', minLength: 1},
                    parentLocationId: {type: ['integer', 'null'], minimum: 1},
                    timeZone: {type: ['string', 'null'], minLength: 1}
                }
            }
        },
        physicalSources: {
            type: 'array',
            items: OPERATIONAL_PHYSICAL_SOURCE_CHOICE_SCHEMA
        },
        logicalMeters: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'meterId',
                    'name',
                    'locationId',
                    'utilityType',
                    'aggregationMode',
                    'pointCount'
                ],
                properties: {
                    meterId: {type: 'integer', minimum: 1},
                    name: {type: 'string', minLength: 1},
                    locationId: {type: ['integer', 'null'], minimum: 1},
                    utilityType: {type: 'string', minLength: 1},
                    aggregationMode: {type: 'string', minLength: 1},
                    pointCount: {type: 'integer', minimum: 0}
                }
            }
        },
        logicalDevices: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'logicalDeviceId',
                    'deviceId',
                    'label',
                    'locationId',
                    'component',
                    'counterField'
                ],
                properties: {
                    logicalDeviceId: {type: 'integer', minimum: 1},
                    deviceId: SHELLY_ID_SCHEMA,
                    label: {type: 'string', minLength: 1},
                    locationId: {type: 'integer', minimum: 1},
                    component: CHANNEL_SCHEMA,
                    counterField: CHANNEL_SCHEMA
                }
            }
        },
        customDeviceRoles: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: [
                    'customDeviceId',
                    'deviceName',
                    'locationId',
                    'roleKey',
                    'label',
                    'valueType'
                ],
                properties: {
                    customDeviceId: SHELLY_ID_SCHEMA,
                    deviceName: {type: 'string', minLength: 1},
                    locationId: {type: ['integer', 'null'], minimum: 1},
                    roleKey: CUSTOM_DEVICE_ROLE_SCHEMA,
                    label: {type: 'string', minLength: 1},
                    valueType: {
                        type: ['string', 'null'],
                        enum: [
                            'boolean',
                            'number',
                            'string',
                            'event',
                            'json',
                            null
                        ]
                    }
                }
            }
        }
    }
};

function policySchemaForFamily(family: OperationalPolicyFamily): JsonSchema {
    return {
        refrigeration: REFRIGERATION_POLICY_SCHEMA,
        coldChain: COLD_CHAIN_RECORD_POLICY_SCHEMA,
        parking: PARKING_POLICY_SCHEMA,
        irrigation: IRRIGATION_POLICY_SCHEMA,
        pv: PV_POLICY_SCHEMA,
        italiaPoolChemistry: ITALIA_POOL_CHEMISTRY_POLICY_SCHEMA,
        italiaHotWater: ITALIA_HOT_WATER_POLICY_SCHEMA,
        italiaNightFlow: ITALIA_NIGHT_POLICY_SCHEMA,
        italiaPitch: ITALIA_PITCH_POLICY_SCHEMA,
        italiaSitePower: ITALIA_SITE_POWER_POLICY_SCHEMA,
        italiaBreakerTrips: ITALIA_BREAKER_TRIP_POLICY_SCHEMA
    }[family];
}

export const OPERATIONS_DESCRIBE: DescribeOutput = new DescribeBuilder(
    'operations',
    {
        kind: 'fleet-manager',
        description:
            'Evaluate configured operational policies from Fleet data and history.'
    }
)
    .setLimits({
        maxPoliciesPerFamily: OPERATIONAL_POLICY_MAX_COUNT,
        maxSourcesPerPolicy: OPERATIONAL_POLICY_MAX_SOURCES,
        maxPolicyBytes: METADATA_MAX_BYTES
    })
    .registerMethod('GetPolicies', {
        params: OPERATIONS_GET_POLICIES_PARAMS,
        response: OPERATIONAL_POLICIES_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return configured operational policies visible within the caller resource scope.'
    })
    .registerMethod('GetPolicyRegistry', {
        params: OPERATIONS_GET_POLICY_REGISTRY_PARAMS,
        response: OPERATIONAL_POLICY_REGISTRY_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return the Fleet-owned policy registry, including editable canonical policy schemas for settings clients.'
    })
    .registerMethod('GetPolicySelectorCatalog', {
        params: OPERATIONS_GET_POLICY_SELECTOR_CATALOG_PARAMS,
        response: OPERATIONAL_POLICY_SELECTOR_CATALOG_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return exact persisted Fleet source identities and scoped logical choices for one operational-policy family.'
    })
    .registerMethod('SetPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_POLICY_PARAMS,
        response: {
            oneOf: OPERATIONAL_POLICY_FAMILIES.map(policySchemaForFamily)
        },
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one policy through the Fleet-owned family registry. The policy must satisfy that family’s canonical schema.'
    })
    .registerMethod('GetRefrigerationPeerHealth', {
        params: OPERATIONS_GET_REFRIGERATION_PEER_HEALTH_PARAMS,
        response: REFRIGERATION_RESPONSE_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return a configured refrigeration peer-health verdict and its source coverage.'
    })
    .registerMethod('GetColdChainRecordVerdict', {
        params: OPERATIONS_GET_COLD_CHAIN_RECORD_VERDICT_PARAMS,
        response: COLD_CHAIN_RECORD_RESPONSE_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return today’s Fleet-owned cold-chain record verdict for one configured location policy.'
    })
    .registerMethod('GetParkingOperationalVerdict', {
        params: OPERATIONS_GET_PARKING_OPERATIONAL_VERDICT_PARAMS,
        response: PARKING_RESPONSE_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return configured per-spot parking occupancy plus smoke, flood, and gas safety verdicts, operational status, and source coverage.'
    })
    .registerMethod('GetIrrigationVerdict', {
        params: OPERATIONS_GET_IRRIGATION_VERDICT_PARAMS,
        response: IRRIGATION_RESPONSE_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return a configured irrigation schedule-execution verdict from persisted valve and optional skip-sensor history.'
    })
    .registerMethod('GetPvHealthVerdict', {
        params: OPERATIONS_GET_PV_HEALTH_VERDICT_PARAMS,
        response: PV_HEALTH_RESPONSE_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return a configured PV generation comparison verdict. Attention is advisory, not a fault.'
    })
    .registerMethod('GetItaliaHotWaterVerdict', {
        params: OPERATIONS_GET_ITALIA_HOT_WATER_VERDICT_PARAMS,
        response: ITALIA_HOT_WATER_VERDICT_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return configured Italia hot-water block verdicts for the current local day from Fleet sensor history.'
    })
    .registerMethod('GetItaliaPoolRegister', {
        params: OPERATIONS_GET_ITALIA_POOL_REGISTER_PARAMS,
        response: {
            type: 'array',
            maxItems: 366,
            items: ITALIA_POOL_REGISTER_VERDICT_SCHEMA
        },
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return Fleet-owned Italia daily pool-register documents, including missing entries, source provenance, configured bands, and compliance.'
    })
    .registerMethod('GetItaliaReopeningFlushVerdict', {
        params: OPERATIONS_GET_ITALIA_REOPENING_FLUSH_VERDICT_PARAMS,
        response: ITALIA_REOPENING_FLUSH_VERDICT_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return configured Italia reopening-flush hold verdicts for an explicit period from Fleet sensor history.'
    })
    .registerMethod('GetItaliaNightFlowVerdicts', {
        params: OPERATIONS_GET_ITALIA_NIGHT_FLOW_VERDICTS_PARAMS,
        response: {type: 'array', items: ITALIA_NIGHT_VERDICT_SCHEMA},
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return configured Italia night-flow zone verdicts from Fleet history.'
    })
    .registerMethod('GetItaliaPitchVerdict', {
        params: OPERATIONS_GET_ITALIA_PITCH_VERDICT_PARAMS,
        response: ITALIA_PITCH_VERDICT_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return one configured Italia pitch electrical-load verdict.'
    })
    .registerMethod('GetItaliaSitePowerVerdict', {
        params: OPERATIONS_GET_ITALIA_SITE_POWER_VERDICT_PARAMS,
        response: ITALIA_SITE_POWER_VERDICT_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return one configured Italia site-power verdict from its Fleet logical meter.'
    })
    .registerMethod('GetItaliaBreakerTripVerdict', {
        params: OPERATIONS_GET_ITALIA_BREAKER_TRIP_VERDICT_PARAMS,
        response: ITALIA_BREAKER_TRIP_VERDICT_SCHEMA,
        permission: {component: 'organizations', operation: 'read'},
        description:
            'Return one configured Italia pitch breaker-trip count from the stable Fleet device journal.'
    })
    .registerMethod('SetRefrigerationPeerPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_REFRIGERATION_PEER_POLICY_PARAMS,
        response: REFRIGERATION_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one refrigeration peer-energy policy with explicit source groups, drift threshold, minimum group size, and freshness.'
    })
    .registerMethod('SetColdChainRecordPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_COLD_CHAIN_RECORD_POLICY_PARAMS,
        response: COLD_CHAIN_RECORD_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one cold-chain record policy with explicit source mappings, limits, deadline, timezone, freshness, and retention.'
    })
    .registerMethod('SetParkingOperationalPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_PARKING_OPERATIONAL_POLICY_PARAMS,
        response: PARKING_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one location parking policy with explicit occupancy calibration, smoke, flood, and gas safety sources, and freshness.'
    })
    .registerMethod('SetIrrigationPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_IRRIGATION_POLICY_PARAMS,
        response: IRRIGATION_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one organization irrigation policy. The organization timezone evaluates daily schedules.'
    })
    .registerMethod('SetPvHealthPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_PV_HEALTH_POLICY_PARAMS,
        response: PV_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one PV health policy with explicit source mappings, comparison window, and advisory threshold.'
    })
    .registerMethod('SetItaliaHotWaterPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_HOT_WATER_POLICY_PARAMS,
        response: ITALIA_HOT_WATER_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one Italia hot-water policy with explicit block sensor mappings, limits, freshness, gap, and hold duration.'
    })
    .registerMethod('SetItaliaPoolChemistryPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_POOL_CHEMISTRY_POLICY_PARAMS,
        response: ITALIA_POOL_CHEMISTRY_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one Italia pool-register policy with its site, season, legal bands, and measured source mappings.'
    })
    .registerMethod('SetItaliaPoolRegisterEntry', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_POOL_REGISTER_ENTRY_PARAMS,
        response: ITALIA_POOL_REGISTER_STORED_ENTRY_SCHEMA,
        permission: {component: 'locations', operation: 'update'},
        description:
            'Create or replace one manually entered Italia pool-register value and return Fleet acceptance provenance.'
    })
    .registerMethod('DeleteItaliaPoolRegisterEntry', {
        safety: {operation: 'update'},
        params: OPERATIONS_DELETE_ITALIA_POOL_REGISTER_ENTRY_PARAMS,
        response: DELETE_POLICY_RESPONSE_SCHEMA,
        permission: {component: 'locations', operation: 'update'},
        description:
            'Delete one manually entered Italia pool-register value within its organization, site, pool, and day.'
    })
    .registerMethod('SetItaliaNightFlowPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_NIGHT_FLOW_POLICY_PARAMS,
        response: ITALIA_NIGHT_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one Italia night-flow site policy with explicit zone mappings.'
    })
    .registerMethod('SetItaliaPitchPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_PITCH_POLICY_PARAMS,
        response: ITALIA_PITCH_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one Italia pitch policy with its source, rating, thresholds, and freshness.'
    })
    .registerMethod('SetItaliaSitePowerPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_SITE_POWER_POLICY_PARAMS,
        response: ITALIA_SITE_POWER_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one Italia site-power policy with its logical meter, contracted capacity, margin, warning, disconnect duration, and freshness.'
    })
    .registerMethod('SetItaliaBreakerTripPolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_SET_ITALIA_BREAKER_TRIP_POLICY_PARAMS,
        response: ITALIA_BREAKER_TRIP_POLICY_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Create or replace one Italia breaker-trip policy with its stable logical device, counter source, and history window.'
    })
    .registerMethod('DeletePolicy', {
        safety: {operation: 'update'},
        params: OPERATIONS_DELETE_POLICY_PARAMS,
        response: DELETE_POLICY_RESPONSE_SCHEMA,
        permission: {component: 'organizations', operation: 'update'},
        description:
            'Delete one configured operational policy by family and policy identifier.'
    })
    .build();
