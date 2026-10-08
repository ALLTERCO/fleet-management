import type {CommodityRepairRepository} from '../../modules/repositories/CommodityRepairRepository';
import RpcError from '../../rpc/RpcError';
import type {
    ElectricalSource,
    EnergyApplyCommodityRepairParams,
    EnergyApplyCommodityRepairResponse,
    EnergyCommodity,
    EnergyPreviewCommodityRepairParams,
    EnergyPreviewCommodityRepairResponse
} from '../../types/api/energy';
import {
    type DeviceAccessSender,
    senderCanAccessDevice
} from './deviceAccessFilter';

const MAX_REPAIR_RANGE_MS = 366 * 24 * 60 * 60 * 1000;

export interface CommodityRepairSender extends DeviceAccessSender {
    getOrganizationId(): string | undefined;
    getUserId?(): string | undefined;
}

export async function handlePreviewCommodityRepair(
    params: EnergyPreviewCommodityRepairParams,
    sender: CommodityRepairSender,
    repo: CommodityRepairRepository
): Promise<EnergyPreviewCommodityRepairResponse> {
    const orgId = requireOrganization(sender);
    await requireDeviceAccess(params.deviceId, sender);
    validateRepairRequest(params);
    return repo.preview(orgId, params, sender.getUserId?.() ?? null);
}

export async function handleApplyCommodityRepair(
    params: EnergyApplyCommodityRepairParams,
    sender: CommodityRepairSender,
    repo: CommodityRepairRepository
): Promise<EnergyApplyCommodityRepairResponse> {
    const orgId = requireOrganization(sender);
    await requireDeviceAccess(params.deviceId, sender);
    // The DB checks that previewId belongs to the same org and device under
    // lock, so a caller cannot swap a permitted device onto another preview.
    return repo.apply(
        orgId,
        params.previewId,
        params.deviceId,
        sender.getUserId?.() ?? null
    );
}

function requireOrganization(sender: CommodityRepairSender): string {
    const orgId = sender.getOrganizationId();
    if (!orgId) throw RpcError.Unauthorized();
    return orgId;
}

async function requireDeviceAccess(
    deviceId: number,
    sender: CommodityRepairSender
): Promise<void> {
    if (!(await senderCanAccessDevice(deviceId, sender))) {
        throw RpcError.Domain('PermissionDenied');
    }
}

function validateRepairRequest(
    params: EnergyPreviewCommodityRepairParams
): void {
    const from = new Date(params.from);
    const to = new Date(params.to);
    if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        to <= from
    ) {
        throw invalid('to must be later than from');
    }
    if (to.getTime() - from.getTime() > MAX_REPAIR_RANGE_MS) {
        throw invalid('commodity repair range cannot exceed 366 days');
    }
    if (to.getTime() > Date.now()) {
        throw invalid('commodity repair must end in recorded history');
    }
    assertAxes(
        params.tag,
        params.expectedCommodity,
        params.expectedElectricalSource,
        'expected'
    );
    assertAxes(
        params.tag,
        params.targetCommodity,
        params.targetElectricalSource,
        'target'
    );
    if (
        params.expectedCommodity === params.targetCommodity &&
        params.expectedElectricalSource === params.targetElectricalSource
    ) {
        throw invalid('target identity must differ from expected identity');
    }
}

function assertAxes(
    tag: EnergyPreviewCommodityRepairParams['tag'],
    commodity: EnergyCommodity,
    electricalSource: ElectricalSource | null,
    label: string
): void {
    const allowed = allowedCommodities(tag);
    if (!allowed.has(commodity)) {
        throw invalid(
            `${label} commodity '${commodity}' is invalid for '${tag}'`
        );
    }
    if (commodity === 'electricity' && electricalSource === null) {
        throw invalid(`${label} electrical source is required for electricity`);
    }
    if (commodity !== 'electricity' && electricalSource !== null) {
        throw invalid(
            `${label} electrical source must be null for ${commodity}`
        );
    }
}

function allowedCommodities(
    tag: EnergyPreviewCommodityRepairParams['tag']
): ReadonlySet<EnergyCommodity> {
    if (tag === 'volume_l' || tag === 'volume_m3') {
        return new Set(['water', 'gas']);
    }
    return new Set(['electricity']);
}

function invalid(message: string): RpcError {
    return RpcError.Domain('ValidationFailed', {
        message,
        field: 'commodityRepair'
    });
}
