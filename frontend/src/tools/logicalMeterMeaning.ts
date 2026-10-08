import type {
    EnergyApplyLogicalMeterMeaningChangeParams,
    EnergyApplyLogicalMeterMeaningChangeResponse,
    EnergyListLogicalMeterMeaningHistoryParams,
    EnergyListLogicalMeterMeaningHistoryResponse,
    EnergyListLogicalMeterMeaningReviewQueueParams,
    EnergyListLogicalMeterMeaningReviewQueueResponse,
    EnergyPreviewLogicalMeterMeaningChangeParams,
    EnergyPreviewLogicalMeterMeaningChangeResponse
} from '@api/energy';
import * as ws from '@/tools/websocket';

const DST = 'FLEET_MANAGER';

export function listLogicalMeterMeaningReviewQueue(
    params: EnergyListLogicalMeterMeaningReviewQueueParams = {}
): Promise<EnergyListLogicalMeterMeaningReviewQueueResponse> {
    return ws.sendRPC(DST, 'energy.ListLogicalMeterMeaningReviewQueue', params);
}

export function listLogicalMeterMeaningHistory(
    params: EnergyListLogicalMeterMeaningHistoryParams
): Promise<EnergyListLogicalMeterMeaningHistoryResponse> {
    return ws.sendRPC(DST, 'energy.ListLogicalMeterMeaningHistory', params);
}

export function previewLogicalMeterMeaningChange(
    params: EnergyPreviewLogicalMeterMeaningChangeParams
): Promise<EnergyPreviewLogicalMeterMeaningChangeResponse> {
    return ws.sendRPC(DST, 'energy.PreviewLogicalMeterMeaningChange', params);
}

export function applyLogicalMeterMeaningChange(
    params: EnergyApplyLogicalMeterMeaningChangeParams
): Promise<EnergyApplyLogicalMeterMeaningChangeResponse> {
    return ws.sendRPC(DST, 'energy.ApplyLogicalMeterMeaningChange', params);
}
