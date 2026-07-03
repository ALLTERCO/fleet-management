// Tier 3 classifier table — maps BTHome v2 object IDs to canonical
// energy tags. Source of truth for object_id → name/unit is
// config/BTHomeData (kept in sync with https://bthome.io/format/).
// This module holds the energy-relevant subset plus the per-object
// storage units, isDelta flag, and unit scale.

import {bthomeObjectInfos} from '../config/BTHomeData';
import type {EnergyDomain, EnergyTag} from './energyClassifier';

export interface BTHomeEnergySpec {
    tag: EnergyTag;
    domain: EnergyDomain;
    isDelta: boolean;
    // Multiplier from the BTHome wire value to the storage unit
    // (e.g. kWh → Wh = 1000). 1 means no scaling.
    scale: number;
}

// Domain defaults follow the BLU MCB / BLU energy product line — those
// are the only BTHome devices that emit energy. Operator can override
// per-device via PR 5's classification UI for the unusual case of a
// custom DC BLU sensor wired via a Pill running BTHome relay scripts.
export const BTHOME_ENERGY_SPEC: Readonly<Record<number, BTHomeEnergySpec>> = {
    10: {
        tag: 'total_act_energy',
        domain: 'ac_mains',
        isDelta: true,
        scale: 1000
    },
    11: {tag: 'power', domain: 'ac_mains', isDelta: false, scale: 1},
    12: {tag: 'voltage', domain: 'ac_mains', isDelta: false, scale: 1},
    67: {tag: 'current', domain: 'ac_mains', isDelta: false, scale: 1},
    71: {
        tag: 'volume_storage_l',
        domain: 'unspecified',
        isDelta: false,
        scale: 1
    },
    72: {
        tag: 'volume_storage_l',
        domain: 'unspecified',
        isDelta: false,
        scale: 0.001
    },
    73: {
        tag: 'volume_flow_m3h',
        domain: 'unspecified',
        isDelta: false,
        scale: 1
    },
    74: {tag: 'voltage', domain: 'ac_mains', isDelta: false, scale: 1},
    75: {tag: 'volume_m3', domain: 'unspecified', isDelta: true, scale: 1},
    76: {tag: 'volume_m3', domain: 'unspecified', isDelta: true, scale: 1},
    77: {
        tag: 'total_act_energy',
        domain: 'ac_mains',
        isDelta: true,
        scale: 1000
    },
    78: {
        tag: 'volume_storage_l',
        domain: 'unspecified',
        isDelta: false,
        scale: 1
    },
    79: {tag: 'volume_l', domain: 'unspecified', isDelta: true, scale: 1},
    85: {
        tag: 'volume_storage_l',
        domain: 'unspecified',
        isDelta: false,
        scale: 1
    },
    92: {tag: 'power', domain: 'ac_mains', isDelta: false, scale: 1},
    93: {tag: 'current', domain: 'ac_mains', isDelta: false, scale: 1}
};

export function lookupBTHomeEnergy(objId: number): BTHomeEnergySpec | null {
    return BTHOME_ENERGY_SPEC[objId] ?? null;
}

// Module-load drift guard: every obj_id in BTHOME_ENERGY_SPEC must
// exist in the upstream object table. If an ID gets retired upstream
// or renumbered, fail loudly here instead of silently misclassifying.
for (const objIdStr of Object.keys(BTHOME_ENERGY_SPEC)) {
    const objId = Number(objIdStr);
    if (!bthomeObjectInfos[objId]) {
        throw new Error(
            `BTHOME_ENERGY_SPEC references obj_id ${objId} not present in bthomeObjectInfos`
        );
    }
}
