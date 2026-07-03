// Handler for Energy.GetResetAudit — reads device_em.lifetime_counters
// via fn_get_reset_audit, then filters rows the sender can't read so
// cross-org callers can't snoop. Tiny enough that the PG call lives
// inline; pulls into its own repo seam if a second caller appears.

import {type DbResult, rawCall} from '../../modules/PostgresProvider';
import RpcError from '../../rpc/RpcError';
import type {
    EnergyGetResetAuditParams,
    EnergyGetResetAuditResponse,
    EnergyResetAuditRow
} from '../../types/api/energy';
import {
    type DeviceAccessSender,
    filterRowsByDeviceAccess,
    senderCanAccessDevice
} from './deviceAccessFilter';

export type ResetAuditFetcher = (
    params: EnergyGetResetAuditParams
) => Promise<EnergyResetAuditRow[]>;

export const productionFetcher: ResetAuditFetcher = async (params) => {
    const result = await rawCall('device_em.fn_get_reset_audit', {
        p_window_days: params.windowDays ?? null,
        p_device: params.deviceId ?? null
    });
    return mapRows(result);
};

export async function handleGetResetAudit(
    params: EnergyGetResetAuditParams,
    fetch: ResetAuditFetcher,
    sender: DeviceAccessSender
): Promise<EnergyGetResetAuditResponse> {
    if (params.deviceId !== undefined) {
        const allowed = await senderCanAccessDevice(params.deviceId, sender);
        if (!allowed) throw RpcError.Domain('PermissionDenied');
    }
    const rows = await fetch(params);
    const items = await filterRowsByDeviceAccess(rows, sender);
    return {items};
}

function mapRows(result: unknown): EnergyResetAuditRow[] {
    const rows = (result as DbResult)?.rows ?? [];
    return rows.map((r) => ({
        deviceId: r.device as number,
        channel: r.channel as number,
        tag: r.tag as string,
        resetCount: r.reset_count as number,
        lastResetAt: r.last_reset_ts ? String(r.last_reset_ts) : null,
        lastSeenAt: r.last_seen_ts ? String(r.last_seen_ts) : null
    }));
}
