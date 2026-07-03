// Persistence seam for fm.energy_classification — the tier-1 operator
// overrides the energy classifier reads first. Pure SQL wrapper, no
// caching. listClassifications seeds the override cache at boot
// (energyOverrideLoader); upsertClassification backs Energy.SetPointOverride.
// SQL CHECK constraints on tag/domain mean returned values already match
// the union types in EnergyClassificationRow, so no boundary cast.

import type {EnergyClassificationRow} from '../../types/api/energy';
import {callMethod, type DbResult, rawCall} from '../PostgresProvider';

export async function listClassifications(
    deviceId?: number
): Promise<EnergyClassificationRow[]> {
    const result = await rawCall('fm.fn_list_energy_classifications', {
        p_device: deviceId ?? null
    });
    return mapClassificationRows(result);
}

export async function upsertClassification(params: {
    device: number;
    componentKey: string;
    tag: EnergyClassificationRow['tag'];
    domain: EnergyClassificationRow['domain'];
    channel: number;
    who: string | null;
}): Promise<void> {
    await callMethod('fm.fn_upsert_energy_classification', {
        p_device: params.device,
        p_component_key: params.componentKey,
        p_tag: params.tag,
        p_domain: params.domain,
        p_channel: params.channel,
        p_who: params.who,
        p_source: 'update'
    });
}

function mapClassificationRows(result: unknown): EnergyClassificationRow[] {
    const rows = (result as DbResult)?.rows ?? [];
    return rows.map((r) => ({
        deviceId: r.device as number,
        componentKey: r.component_key as string,
        tag: r.tag as EnergyClassificationRow['tag'],
        domain: r.domain as EnergyClassificationRow['domain'],
        channel: r.channel as number,
        source: r.classifier_source as string,
        declaredAt: String(r.declared_at),
        declaredBy: (r.declared_by as string | null) ?? null
    }));
}
