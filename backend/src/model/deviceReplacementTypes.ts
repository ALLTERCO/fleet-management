// Shared device-replacement types. A leaf module so both the replacement
// engine (deviceReplacement) and the mapping validator (deviceReplacementMapping)
// import the shapes without importing each other — no cycle.

import type {EnergyDomain, EnergyTag} from '../modules/energyClassifier';

export type ReplacementCompatibility =
    | 'exact_match'
    | 'compatible_mapping'
    | 'incompatible';

export interface DeviceReplacementPoint {
    channel: number;
    phase: 'a' | 'b' | 'c' | 'z';
    tag: EnergyTag;
    electricalDomain: EnergyDomain | null;
}

export interface DeviceReplacementRequirement extends DeviceReplacementPoint {
    logicalMeterId: number;
    logicalMeterName: string;
    utilityType: string;
    role: string;
}

export interface DeviceReplacementAvailablePoint
    extends DeviceReplacementPoint {
    source: 'history' | 'live';
    componentKey: string | null;
}

export interface DeviceReplacementCandidate {
    required: DeviceReplacementRequirement;
    candidates: DeviceReplacementAvailablePoint[];
}

export interface DeviceReplacementCheckResult {
    oldShellyID: string;
    newShellyID: string;
    oldDeviceId: number;
    newDeviceId: number;
    compatibility: ReplacementCompatibility;
    requirements: DeviceReplacementRequirement[];
    available: DeviceReplacementAvailablePoint[];
    missing: DeviceReplacementRequirement[];
    remapCandidates: DeviceReplacementCandidate[];
    warnings: string[];
}
