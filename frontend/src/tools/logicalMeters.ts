// Frontend API for device Energy assignment. One home for the RPC method names.

import type {
    EnergyDeleteLogicalMeterResponse,
    EnergyListLogicalMetersResponse,
    EnergyListMeasurementPointsParams,
    EnergyListMeasurementPointsResponse,
    EnergyLogicalMeter,
    EnergyMeasurementPoint,
    EnergySaveLogicalMeterParams,
    EnergySaveLogicalMeterResponse
} from '@api/energy';
import * as ws from '@/tools/websocket';

const DST = 'FLEET_MANAGER';

export function listMeasurementPoints(
    params: EnergyListMeasurementPointsParams
): Promise<EnergyMeasurementPoint[]> {
    return ws
        .sendRPC<EnergyListMeasurementPointsResponse>(
            DST,
            'energy.ListMeasurementPoints',
            params
        )
        .then((r) => r.points);
}

export function listLogicalMeters(): Promise<EnergyLogicalMeter[]> {
    return ws
        .sendRPC<EnergyListLogicalMetersResponse>(
            DST,
            'energy.ListLogicalMeters',
            {}
        )
        .then((r) => r.meters);
}

export function saveLogicalMeter(
    params: EnergySaveLogicalMeterParams
): Promise<EnergyLogicalMeter> {
    return ws
        .sendRPC<EnergySaveLogicalMeterResponse>(
            DST,
            'energy.SaveLogicalMeter',
            params
        )
        .then((r) => r.meter);
}

export function deleteLogicalMeter(id: number): Promise<boolean> {
    return ws
        .sendRPC<EnergyDeleteLogicalMeterResponse>(
            DST,
            'energy.DeleteLogicalMeter',
            {id}
        )
        .then((r) => r.deleted);
}
