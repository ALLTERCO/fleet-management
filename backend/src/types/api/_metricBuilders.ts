// Builders for component metric descriptors. One source of truth for each
// quantity's IEC 61850 metadata, reused by every component describe so the
// mapping lives in exactly one place. Field names stay firmware-defined and
// are passed in by each component.

import type {MetricDescriptor} from './_describe';
import type {
    Direction,
    LogicalNode,
    MeasurementMeta,
    Phase
} from './measurement';
import type {SemanticType} from './semantic';

type Quantity =
    | 'active_power'
    | 'apparent_power'
    | 'current'
    | 'voltage'
    | 'power_factor'
    | 'frequency'
    | 'active_energy';

interface QuantityDef {
    logicalNode: LogicalNode;
    dataObject: string;
    /** IEC 61850 data object when the field aggregates all phases. */
    totalDataObject?: string;
    /** Omitted for dimensionless quantities (power factor). */
    unit?: string;
    /** Semantic type for display formatting. */
    semantic: SemanticType;
}

// Best-effort IEC 61850 data objects (W/TotW, VA/TotVA, PhV, A, PF, Hz, TotWh).
const QUANTITY: Record<Quantity, QuantityDef> = {
    active_power: {
        logicalNode: 'MMXU',
        dataObject: 'W',
        totalDataObject: 'TotW',
        unit: 'W',
        semantic: 'power'
    },
    apparent_power: {
        logicalNode: 'MMXU',
        dataObject: 'VA',
        totalDataObject: 'TotVA',
        unit: 'VA',
        semantic: 'power'
    },
    current: {
        logicalNode: 'MMXU',
        dataObject: 'A',
        unit: 'A',
        semantic: 'current'
    },
    voltage: {
        logicalNode: 'MMXU',
        dataObject: 'PhV',
        unit: 'V',
        semantic: 'voltage'
    },
    power_factor: {
        logicalNode: 'MMXU',
        dataObject: 'PF',
        semantic: 'power_factor'
    },
    frequency: {
        logicalNode: 'MMXU',
        dataObject: 'Hz',
        unit: 'Hz',
        semantic: 'frequency'
    },
    active_energy: {
        logicalNode: 'MMTR',
        dataObject: 'TotWh',
        unit: 'Wh',
        semantic: 'energy'
    }
};

// Sensor unit -> semantic type. The unit a component reports is enough to know
// how to format it; an unmapped unit leaves the metric without a semantic.
// Only Celsius maps to `temperature`: the temperature formatter converts C->F
// for imperial orgs, so tagging a native-Fahrenheit field would double-convert.
const SENSOR_SEMANTIC: Record<string, SemanticType> = {
    '°C': 'temperature',
    '%': 'percent_pct',
    lx: 'illuminance',
    V: 'voltage',
    A: 'current',
    Hz: 'frequency',
    Pa: 'pressure',
    s: 'duration',
    count: 'count'
};

interface ElectricalOpts {
    phase?: Phase;
    total?: boolean;
    direction?: Direction;
    optional?: boolean;
}

// Electrical metric — pulls its measurement from the quantity table above.
export function electrical(
    name: string,
    quantity: Quantity,
    opts: ElectricalOpts = {}
): MetricDescriptor {
    const q = QUANTITY[quantity];
    const measurement: MeasurementMeta = {
        logicalNode: q.logicalNode,
        dataObject:
            opts.total && q.totalDataObject ? q.totalDataObject : q.dataObject,
        accumulation: q.logicalNode === 'MMTR' ? 'cumulative' : 'instant',
        ...(opts.phase ? {phase: opts.phase} : {}),
        ...(q.unit ? {unit: q.unit} : {}),
        ...(opts.direction ? {direction: opts.direction} : {})
    };
    return {
        name,
        type: 'number',
        measurement,
        semantic: q.semantic,
        ...(opts.optional ? {optional: true} : {})
    };
}

// Non-electrical sensor metric — IEC 61850 is electrical, so these carry only
// the unit (and instant accumulation), no logical node or data object.
export function sensor(
    name: string,
    unit: string,
    opts: {optional?: boolean} = {}
): MetricDescriptor {
    const semantic = SENSOR_SEMANTIC[unit];
    return {
        name,
        type: 'number',
        measurement: {accumulation: 'instant', unit},
        ...(semantic ? {semantic} : {}),
        ...(opts.optional ? {optional: true} : {})
    };
}

// State metric — a boolean the component reports (alarm, occupied). Not a
// measured quantity, so it carries no unit; the instant accumulation marks it
// as a point-in-time reading.
export function state(
    name: string,
    opts: {optional?: boolean} = {}
): MetricDescriptor {
    return {
        name,
        type: 'boolean',
        measurement: {accumulation: 'instant'},
        semantic: 'state',
        ...(opts.optional ? {optional: true} : {})
    };
}

// Integer count the component reports (objects in zone, cycle counters).
export function count(
    name: string,
    opts: {optional?: boolean} = {}
): MetricDescriptor {
    return {
        name,
        type: 'integer',
        measurement: {accumulation: 'instant', unit: 'count'},
        semantic: 'count',
        ...(opts.optional ? {optional: true} : {})
    };
}
