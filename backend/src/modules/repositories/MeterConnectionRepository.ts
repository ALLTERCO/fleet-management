// Persistence seam for fm.meter_connection — pure SQL wrapper over the
// fm.fn_*_meter_connection(s) stored functions. No caching, no in-memory
// state. Every call is org-scoped: the stored functions refuse cross-org
// reads/writes, and the same-org FK on meter_id is the DB backstop against
// a cross-tenant meter reference. DB CHECK constraints guarantee the
// returned vocabulary matches the API union types, so rows map to the API
// shape with no boundary cast.

import type {EnergyMeterConnection} from '../../types/api/energy';
import {
    callMethod,
    type DbResult,
    extractScalarBoolean,
    extractScalarNumber,
    rawCall
} from '../PostgresProvider';

export interface SaveMeterConnectionDbParams {
    /** null = create (upsert on the UNIQUE key), else update that edge. */
    id: number | null;
    org: string;
    meterId: number;
    fromNode: string;
    toNode: string;
    positiveDirection: string;
}

export async function saveMeterConnection(
    params: SaveMeterConnectionDbParams
): Promise<number> {
    const result = await callMethod('fm.fn_save_meter_connection', {
        p_id: params.id,
        p_org: params.org,
        p_meter_id: params.meterId,
        p_from_node: params.fromNode,
        p_to_node: params.toNode,
        p_positive_direction: params.positiveDirection
    });
    return extractScalarNumber(result);
}

export async function deleteMeterConnection(
    id: number,
    org: string
): Promise<boolean> {
    const result = await callMethod('fm.fn_delete_meter_connection', {
        p_id: id,
        p_org: org
    });
    return extractScalarBoolean(result);
}

export async function listMeterConnections(
    org: string
): Promise<EnergyMeterConnection[]> {
    const result = await rawCall('fm.fn_list_meter_connections', {
        p_org: org
    });
    return mapConnectionRows(result);
}

function mapConnectionRows(result: unknown): EnergyMeterConnection[] {
    const rows = (result as DbResult)?.rows ?? [];
    return rows.map((r) => ({
        id: Number(r.id),
        meterId: Number(r.meter_id),
        fromNode: r.from_node as EnergyMeterConnection['fromNode'],
        toNode: r.to_node as EnergyMeterConnection['toNode'],
        positiveDirection:
            r.positive_direction as EnergyMeterConnection['positiveDirection']
    }));
}
