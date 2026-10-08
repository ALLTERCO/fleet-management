import type {Dashboard} from '@api/dashboard';
import type {DashboardScope as ApiDashboardScope} from '@api/fleet';
import {
    fromApiDashboardScope,
    type DashboardScope
} from '@/composables/useDashboardScope';
import * as ws from '@/tools/websocket';

export interface DashboardRecordSummary {
    name: string | null;
    scope: DashboardScope;
    apiScope: ApiDashboardScope;
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
        scope: fromApiDashboardScope(dashboard.scope),
        apiScope: dashboard.scope ?? {}
    };
}
