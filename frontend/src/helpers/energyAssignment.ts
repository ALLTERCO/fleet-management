import {
    ENERGY_UTILITY_TYPES,
    type EnergyLogicalMeterPoint,
    type EnergyMeasurementPoint,
    type EnergyMeterRole,
    type EnergyPhaseMode,
    type EnergyUtilityType,
    meterTagsForUtility
} from '@api/energy';

export interface EnergyAssignmentRoleOption {
    label: string;
    role: EnergyMeterRole;
}

const ELECTRIC_ROLES: ReadonlyArray<EnergyAssignmentRoleOption> = [
    {label: 'Grid source', role: 'grid'},
    {label: 'Generated energy', role: 'pv'},
    {label: 'Battery', role: 'battery'},
    {label: 'Generator', role: 'generator'},
    {label: 'EV charger', role: 'ev_charge'},
    {label: 'Load / appliance', role: 'load'},
    {label: 'Other / auxiliary', role: 'aux'}
];

const RESOURCE_ROLES: ReadonlyArray<EnergyAssignmentRoleOption> = [
    {label: 'Supply / import', role: 'supply'},
    {label: 'Production', role: 'production'},
    {label: 'Storage', role: 'storage'},
    {label: 'Usage / load', role: 'usage'},
    {label: 'Other / auxiliary', role: 'aux'}
];

export const ENERGY_ASSIGNMENT_ROLES = ELECTRIC_ROLES;

export const ENERGY_ASSIGNMENT_ROLES_BY_UTILITY: Readonly<
    Record<EnergyUtilityType, ReadonlyArray<EnergyAssignmentRoleOption>>
> = {
    electric: ELECTRIC_ROLES,
    gas: RESOURCE_ROLES,
    water: RESOURCE_ROLES,
    heat: RESOURCE_ROLES
};

export function energyRolesForUtility(
    utilityType: EnergyUtilityType
): ReadonlyArray<EnergyAssignmentRoleOption> {
    return ENERGY_ASSIGNMENT_ROLES_BY_UTILITY[utilityType];
}

const TAG_LABELS: Record<string, string> = {
    total_act_energy: 'Energy',
    total_act_ret_energy: 'Exported energy',
    power: 'Power',
    voltage: 'Voltage',
    current: 'Current',
    volume_l: 'Consumed volume · import',
    volume_m3: 'Consumed volume · import',
    volume_returned_m3: 'Returned gas volume · network injection',
    volume_storage_l: 'Stored volume',
    volume_flow_m3h: 'Flow',
    thermal_energy_kwh: 'Thermal energy'
};

export function energyPointKey(point: EnergyMeasurementPoint): string {
    return `${point.deviceId}|${point.channel}|${point.phase}|${point.tag}`;
}

export function energyPointLabel(point: EnergyMeasurementPoint): string {
    const phase =
        point.phase === 'z' ? 'whole' : `phase ${point.phase.toUpperCase()}`;
    return `Channel ${point.channel}, ${phase}`;
}

export function energyTagLabel(tag: string): string {
    return TAG_LABELS[tag] ?? tag;
}

export function energyPointFlowDirection(
    point: Pick<EnergyMeasurementPoint, 'tag' | 'electricalDomain'>
): 'import' | 'export' | null {
    if (point.tag === 'total_act_ret_energy') return 'export';
    if (point.tag === 'total_act_energy') return 'import';
    if (point.electricalDomain !== 'gas') return null;
    if (point.tag === 'volume_returned_m3') return 'export';
    if (point.tag === 'volume_m3' || point.tag === 'volume_l') return 'import';
    return null;
}

export function energyPointSupportsUtility(
    point: EnergyMeasurementPoint,
    utilityType: EnergyUtilityType
): boolean {
    if (!meterTagsForUtility(utilityType).includes(point.tag)) return false;
    if (
        point.tag !== 'volume_m3' &&
        point.tag !== 'volume_returned_m3' &&
        point.tag !== 'volume_l'
    )
        return true;
    return utilityType === 'gas'
        ? point.electricalDomain === 'gas'
        : utilityType === 'water' && point.electricalDomain !== 'gas';
}

export function suggestedUtilityForPoints(
    points: readonly EnergyMeasurementPoint[]
): EnergyUtilityType | null {
    const candidates = ENERGY_UTILITY_TYPES.filter((utilityType) =>
        points.some((point) => energyPointSupportsUtility(point, utilityType))
    );
    return candidates.length === 1 ? candidates[0] : null;
}

export function deriveEnergyPhaseMode(
    points: readonly EnergyMeasurementPoint[]
): EnergyPhaseMode {
    const phases = new Set(points.map((point) => point.phase));
    if (phases.has('a') && phases.has('b') && phases.has('c')) {
        return 'three_phase';
    }
    const channels = new Set(points.map((point) => point.channel));
    if (phases.size === 1 && phases.has('z') && channels.size === 1) {
        return 'single_phase';
    }
    return 'unknown';
}

export function toLogicalMeterPoint(
    point: EnergyMeasurementPoint
): EnergyLogicalMeterPoint {
    const gasDirection =
        point.electricalDomain === 'gas'
            ? energyPointFlowDirection(point)
            : null;
    return {
        deviceId: point.deviceId,
        componentKey: point.componentKey,
        channel: point.channel,
        phase: point.phase,
        tag: point.tag,
        electricalDomain: point.electricalDomain,
        ...(gasDirection ? {directionHint: gasDirection} : {})
    };
}

export function optionalString(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

export function optionalNumber(value: string): number | null {
    if (value === '') return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}
