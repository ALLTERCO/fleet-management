import type {
    EnergyApplyCommodityRepairResponse,
    EnergyPreviewCommodityRepairParams,
    EnergyPreviewCommodityRepairResponse
} from '../../types/api/energy';
import {type DbResult, rawCall} from '../PostgresProvider';

type RawCall = typeof rawCall;

export interface CommodityRepairRepository {
    preview(
        organizationId: string,
        params: EnergyPreviewCommodityRepairParams,
        requestedBy: string | null
    ): Promise<EnergyPreviewCommodityRepairResponse>;
    apply(
        organizationId: string,
        previewId: number,
        deviceId: number,
        appliedBy: string | null
    ): Promise<EnergyApplyCommodityRepairResponse>;
}

export function createCommodityRepairRepository(
    call: RawCall = rawCall
): CommodityRepairRepository {
    return {
        async preview(organizationId, params, requestedBy) {
            const result = await call('device_em.fn_preview_commodity_repair', {
                p_organization_id: organizationId,
                p_device: params.deviceId,
                p_channel: params.channel,
                p_tag: params.tag,
                p_from: params.from,
                p_to: params.to,
                p_expected_commodity: params.expectedCommodity,
                p_expected_electrical_source: params.expectedElectricalSource,
                p_target_commodity: params.targetCommodity,
                p_target_electrical_source: params.targetElectricalSource,
                p_source_reference: params.sourceReference,
                p_requested_by: requestedBy
            });
            const row = firstRow(result);
            const rowCount = Number(row.row_count);
            const rollupConflictCount = Number(row.rollup_conflict_count);
            const rawConflictCount = Number(row.raw_conflict_count);
            const dirtyCount = Number(row.dirty_count);
            return {
                previewId: Number(row.preview_id),
                eligible: Boolean(row.eligible),
                rowCount,
                rawRowCount: Number(row.raw_row_count),
                quantity: Number(row.quantity),
                conflictCount: rollupConflictCount + rawConflictCount,
                rollupConflictCount,
                rawConflictCount,
                dirtyCount,
                ineligibilityReasons: ineligibilityReasons({
                    rowCount,
                    rollupConflictCount,
                    rawConflictCount,
                    dirtyCount
                }),
                firstBucket: nullableString(row.first_bucket),
                lastBucket: nullableString(row.last_bucket)
            };
        },

        async apply(organizationId, previewId, deviceId, appliedBy) {
            const result = await call('device_em.fn_apply_commodity_repair', {
                p_organization_id: organizationId,
                p_preview_id: previewId,
                p_device: deviceId,
                p_applied_by: appliedBy
            });
            const row = firstRow(result);
            return {
                previewId: Number(row.preview_id),
                status: 'applied',
                appliedRows: Number(row.applied_rows),
                rawRowsReclassified: Number(row.raw_rows_reclassified),
                coverageStart: String(row.coverage_start),
                appliedAt: String(row.applied_at)
            };
        }
    };
}

export const defaultCommodityRepairRepository =
    createCommodityRepairRepository();

function ineligibilityReasons(counts: {
    rowCount: number;
    rollupConflictCount: number;
    rawConflictCount: number;
    dirtyCount: number;
}): EnergyPreviewCommodityRepairResponse['ineligibilityReasons'] {
    const reasons: EnergyPreviewCommodityRepairResponse['ineligibilityReasons'] =
        [];
    if (counts.rowCount === 0) reasons.push('no_source_rows');
    if (counts.rollupConflictCount > 0) reasons.push('rollup_conflict');
    if (counts.rawConflictCount > 0) reasons.push('raw_conflict');
    if (counts.dirtyCount > 0) reasons.push('pending_rollup');
    return reasons;
}

function firstRow(result: unknown): Record<string, unknown> {
    const row = (result as DbResult)?.rows?.[0];
    if (!row)
        throw new Error('Commodity repair database function returned no row');
    return row;
}

function nullableString(value: unknown): string | null {
    return value == null ? null : String(value);
}
