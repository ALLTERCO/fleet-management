import type {
    Dashboard,
    DashboardItem,
    DashboardItemKind,
    DashboardType
} from '@api/dashboard';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {toastRpcError} from '@/helpers/domainErrors';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import * as ws from '../tools/websocket';
import {createRefreshCoordinator} from './refreshCoordinator';
import {useToastStore} from './toast';

export type {Dashboard, DashboardItem, DashboardItemKind, DashboardType};

export interface DashboardTemplate {
    key: string;
    label: string;
    description: string | null;
    dashboardType: DashboardType;
    organizationId: string | null;
    isBuiltin: boolean;
    seed: Record<string, unknown>;
    createdAt: string;
    updatedAt: string | null;
}

// Preview items use the typed wire format — kind enum + per-kind typed FK.
export interface DashboardTemplatePreviewItem {
    kind: DashboardItemKind;
    order: number;
    size: string;
    deviceId?: number | null;
    entitySubId?: string | null;
    groupId?: number | null;
    locationId?: number | null;
    tagId?: number | null;
    actionId?: number | null;
    widgetKind?: string | null;
    widgetConfig?: Record<string, unknown> | null;
}

export interface DashboardTemplatePreview {
    items: DashboardTemplatePreviewItem[];
}

export interface DashboardPin {
    dashboardId: number;
    sortOrder: number;
    pinnedAt: string;
}

export interface CreateDashboardParams {
    name: string;
    dashboardType: DashboardType;
    scope?: {locationId?: number; groupId?: number; tagId?: number};
}

export interface UpdateDashboardPatch {
    name?: string;
    dashboardType?: DashboardType;
    scope?: {locationId?: number; groupId?: number; tagId?: number} | null;
}

export interface UpdateDashboardItemSizeInput {
    dashboardId: number;
    itemId: number;
    size: DashboardItem['size'];
}

export const useDashboardsStore = defineStore('dashboards', () => {
    const toast = useToastStore();

    const dashboards = ref<Record<number, Dashboard>>({});
    const loading = ref(true);

    function upsert(d: Dashboard) {
        dashboards.value = {...dashboards.value, [d.id]: d};
    }

    let latestFetchAllResult: Dashboard[] = [];
    const fetchAllRefresh = createRefreshCoordinator(refreshAllDashboards);

    async function fetchAll(): Promise<Dashboard[]> {
        await fetchAllRefresh.request();
        return latestFetchAllResult;
    }

    async function refreshAllDashboards(): Promise<void> {
        loading.value = true;
        try {
            const res = await ws.sendRPC<{items: Dashboard[]; total: number}>(
                'FLEET_MANAGER',
                'Dashboard.List',
                {}
            );
            const items = res.items ?? [];
            const next: Record<number, Dashboard> = {};
            for (const d of items) next[d.id] = d;
            dashboards.value = next;
            latestFetchAllResult = items;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load dashboards');
            latestFetchAllResult = [];
        } finally {
            loading.value = false;
        }
    }

    async function fetchOne(id: number): Promise<Dashboard | null> {
        try {
            const d = await ws.sendRPC<Dashboard>(
                'FLEET_MANAGER',
                'Dashboard.Get',
                {id}
            );
            upsert(d);
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load dashboard');
            return null;
        }
    }

    async function create(
        params: CreateDashboardParams & {template?: string}
    ): Promise<Dashboard | null> {
        try {
            const d = await ws.sendRPC<Dashboard>(
                'FLEET_MANAGER',
                'Dashboard.Create',
                params
            );
            upsert(d);
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to create dashboard');
            return null;
        }
    }

    async function listTemplates(filter?: {
        dashboardType?: DashboardType;
        includeBuiltin?: boolean;
    }): Promise<DashboardTemplate[]> {
        try {
            const res = await ws.sendRPC<{items: DashboardTemplate[]}>(
                'FLEET_MANAGER',
                'Dashboard.Template.List',
                filter ?? {}
            );
            return res.items ?? [];
        } catch (err) {
            toastRpcError(toast, err, 'Failed to load templates');
            return [];
        }
    }

    async function previewTemplate(
        key: string,
        scope?: {groupId?: number; locationId?: number; tagId?: number}
    ): Promise<DashboardTemplatePreview | null> {
        try {
            return await ws.sendRPC<DashboardTemplatePreview>(
                'FLEET_MANAGER',
                'Dashboard.Template.Preview',
                {key, ...(scope ? {scope} : {})}
            );
        } catch (err) {
            toastRpcError(toast, err, 'Failed to preview template');
            return null;
        }
    }

    async function getDefault(): Promise<number | null> {
        try {
            const res = await ws.sendRPC<{id: number | null}>(
                'FLEET_MANAGER',
                'Dashboard.GetDefault',
                {}
            );
            return res.id ?? null;
        } catch {
            return null;
        }
    }

    async function setDefault(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.SetDefault', {id});
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to set default');
            return false;
        }
    }

    async function clearDefault(): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.ClearDefault', {});
            return true;
        } catch {
            return false;
        }
    }

    async function listPinned(): Promise<DashboardPin[]> {
        try {
            const res = await ws.sendRPC<{items: DashboardPin[]}>(
                'FLEET_MANAGER',
                'Dashboard.ListPinned',
                {}
            );
            return res.items ?? [];
        } catch {
            return [];
        }
    }

    async function pin(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.Pin', {id});
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to pin dashboard');
            return false;
        }
    }

    async function unpin(id: number): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.Unpin', {id});
            return true;
        } catch {
            return false;
        }
    }

    async function reorderPins(ids: number[]): Promise<boolean> {
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.ReorderPins', {ids});
            return true;
        } catch {
            return false;
        }
    }

    async function clone(
        id: number,
        name: string,
        scope?: {groupId?: number; locationId?: number; tagId?: number}
    ): Promise<Dashboard | null> {
        try {
            const d = await ws.sendRPC<Dashboard>(
                'FLEET_MANAGER',
                'Dashboard.Clone',
                {id, name, ...(scope ? {scope} : {})}
            );
            upsert(d);
            return d;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to clone dashboard');
            return null;
        }
    }

    async function update(
        id: number,
        patch: UpdateDashboardPatch
    ): Promise<Dashboard | null> {
        try {
            return await runOptimisticMutation({
                snapshot: () => snapshotDashboard(id),
                apply: () => applyDashboardPatch(id, patch),
                commit: () => commitDashboardUpdate(id, patch),
                rollback: rollbackDashboard,
                reconcile: upsert,
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to update dashboard')
            });
        } catch {
            return null;
        }
    }

    function snapshotDashboard(id: number): Dashboard | undefined {
        return dashboards.value[id];
    }

    function applyDashboardPatch(
        id: number,
        patch: UpdateDashboardPatch
    ): void {
        const current = dashboards.value[id];
        if (!current) return;
        upsert({...current, ...dashboardPatchFields(patch)});
    }

    function dashboardPatchFields(
        patch: UpdateDashboardPatch
    ): Partial<Dashboard> {
        const next: Partial<Dashboard> = {};
        if (patch.name !== undefined) next.name = patch.name;
        if (patch.dashboardType !== undefined) {
            next.dashboardType = patch.dashboardType;
        }
        if (patch.scope !== undefined) {
            next.scope = patch.scope ?? {};
        }
        return next;
    }

    function rollbackDashboard(previous: Dashboard | undefined): void {
        if (!previous) return;
        upsert(previous);
    }

    function commitDashboardUpdate(
        id: number,
        patch: UpdateDashboardPatch
    ): Promise<Dashboard> {
        return ws.sendRPC<Dashboard>('FLEET_MANAGER', 'Dashboard.Update', {
            id,
            ...patch
        });
    }

    async function updateItemSize(
        input: UpdateDashboardItemSizeInput
    ): Promise<boolean> {
        try {
            await runOptimisticMutation({
                snapshot: () => snapshotDashboard(input.dashboardId),
                apply: () => applyDashboardItemSize(input),
                commit: () => commitDashboardItemSize(input),
                rollback: rollbackDashboard,
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to update card size')
            });
            return true;
        } catch {
            return false;
        }
    }

    function applyDashboardItemSize(input: UpdateDashboardItemSizeInput): void {
        const current = dashboards.value[input.dashboardId];
        if (!current) return;
        upsert({
            ...current,
            items: current.items.map((item) =>
                item.id === input.itemId ? {...item, size: input.size} : item
            )
        });
    }

    async function commitDashboardItemSize(
        input: UpdateDashboardItemSizeInput
    ): Promise<void> {
        await ws.sendRPC('FLEET_MANAGER', 'Dashboard.UpdateItemSize', {
            dashboard: input.dashboardId,
            itemId: input.itemId,
            size: input.size
        });
    }

    async function remove(id: number): Promise<boolean> {
        if (!Number.isFinite(id)) return false;
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.Delete', {id});
            const next = {...dashboards.value};
            delete next[id];
            dashboards.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete dashboard');
            return false;
        }
    }

    // Bulk delete in one round-trip. The backend removes only the caller org's
    // dashboards and returns the ids it deleted; we prune those locally.
    async function removeBulk(ids: readonly number[]): Promise<number[]> {
        const valid = ids.filter((id) => Number.isFinite(id));
        if (valid.length === 0) return [];
        try {
            const res = await ws.sendRPC<{deleted: number[]}>(
                'FLEET_MANAGER',
                'Dashboard.DeleteBulk',
                {ids: valid}
            );
            const deleted = res?.deleted ?? [];
            if (deleted.length > 0) {
                const next = {...dashboards.value};
                for (const id of deleted) delete next[id];
                dashboards.value = next;
            }
            return deleted;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to delete dashboards');
            return [];
        }
    }

    // Live updates — backend emits lightweight {dashboardId, ...} payloads;
    // refetch the affected row to stay in sync with the authoritative state.
    ws.onDashboardEvent((e) => {
        const id = e.params.dashboardId as number | undefined;
        if (typeof id !== 'number') return;
        if (e.method === 'Dashboard.Deleted') {
            const next = {...dashboards.value};
            delete next[id];
            dashboards.value = next;
            return;
        }
        void fetchOne(id);
    });

    return {
        dashboards,
        loading,
        upsert,
        fetchAll,
        fetchOne,
        create,
        update,
        updateItemSize,
        remove,
        removeBulk,
        listTemplates,
        previewTemplate,
        getDefault,
        setDefault,
        clearDefault,
        listPinned,
        pin,
        unpin,
        reorderPins,
        clone
    };
});
