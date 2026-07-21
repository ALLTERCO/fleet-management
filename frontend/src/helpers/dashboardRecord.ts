import type {Dashboard} from '@api/dashboard';
import * as ws from '@/tools/websocket';

export interface DashboardRecordSummary {
    name: string | null;
    groupId: number | null;
}

export async function fetchDashboardRecordSummary(
    id: number
): Promise<DashboardRecordSummary | null> {
    if (!Number.isFinite(id)) return null;
    const dashboard = await ws.sendRPC<Dashboard>('FLEET_MANAGER', 'dashboard.Get', {
        id
    });
    return {
        name: dashboard.name ?? null,
        groupId: dashboard.scope?.groupId ?? null
    };
}
