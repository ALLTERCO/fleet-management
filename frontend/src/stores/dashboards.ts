import type {
    Dashboard,
    DashboardItem,
    DashboardItemKind,
    DashboardType
} from '@api/dashboard';
import {defineStore} from 'pinia';
import {ref} from 'vue';
import {useDashboardOrder} from '@/composables/useDashboardOrder';
import {toastRpcError} from '@/helpers/domainErrors';
import {runOptimisticMutation} from '@/stores/optimisticMutation';
import {createBatchCoalescer} from '../tools/coalesce';
import * as ws from '../tools/websocket';
import {DASHBOARD_EVENT} from '../tools/wsEvents';
import {useAuthStore} from './auth';
import {createRefreshCoordinator} from './refreshCoordinator';
import {createStaleGuard} from './staleGuard';
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

    // Bumped on every dashboards write; stale list refreshes are discarded.
    const dashboardsGuard = createStaleGuard();

    // Write path — mutations, WS writes, rollbacks. Bumps to discard stale reads.
    function upsert(d: Dashboard) {
        dashboardsGuard.bump();
        mergeDashboard(d);
    }

    // Read path — never bumps; callers guard with a pre-RPC token instead.
    function mergeDashboard(d: Dashboard) {
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
        const token = dashboardsGuard.current();
        try {
            const res = await ws.sendRPC<{items: Dashboard[]; total: number}>(
                'FLEET_MANAGER',
                'Dashboard.List',
                {}
            );
            // A write landed mid-flight; replacing would overwrite newer state.
            if (dashboardsGuard.isStale(token)) return;
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
        const token = dashboardsGuard.current();
        try {
            const d = await ws.sendRPC<Dashboard>(
                'FLEET_MANAGER',
                'Dashboard.Get',
                {id}
            );
            // A write landed mid-flight; this older read must not overwrite it.
            if (dashboardsGuard.isStale(token)) return d;
            mergeDashboard(d);
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

    // One default per organization. The backend flips it atomically; we mirror
    // that locally so the pill star updates without a full refetch.
    async function setDefault(id: number): Promise<boolean> {
        if (!Number.isFinite(id)) return false;
        try {
            await ws.sendRPC('FLEET_MANAGER', 'Dashboard.SetDefault', {id});
            dashboardsGuard.bump();
            const next: Record<number, Dashboard> = {};
            for (const [key, dash] of Object.entries(dashboards.value)) {
                next[Number(key)] = {...dash, isDefault: dash.id === id};
            }
            dashboards.value = next;
            return true;
        } catch (err) {
            toastRpcError(toast, err, 'Failed to set default dashboard');
            return false;
        }
    }

    async function update(
        id: number,
        patch: UpdateDashboardPatch
    ): Promise<Dashboard | null> {
        try {
            return await runOptimisticMutation({
                snapshot: () => snapshotPatchedFields(id, patch),
                apply: () => applyDashboardPatch(id, patch),
                commit: () => commitDashboardUpdate(id, patch),
                rollback: (fields) => rollbackPatchedFields(id, fields),
                reconcile: upsert,
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to update dashboard')
            });
        } catch {
            return null;
        }
    }

    // Snapshot only patched fields — a whole-row rollback would revert
    // concurrent committed writes.
    function snapshotPatchedFields(
        id: number,
        patch: UpdateDashboardPatch
    ): Partial<Dashboard> | undefined {
        const current = dashboards.value[id];
        if (!current) return undefined;
        const fields: Partial<Dashboard> = {};
        if (patch.name !== undefined) fields.name = current.name;
        if (patch.dashboardType !== undefined) {
            fields.dashboardType = current.dashboardType;
        }
        if (patch.scope !== undefined) fields.scope = current.scope;
        return fields;
    }

    function rollbackPatchedFields(
        id: number,
        fields: Partial<Dashboard> | undefined
    ): void {
        if (!fields) return;
        const current = dashboards.value[id];
        if (!current) return;
        upsert({...current, ...fields});
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
                snapshot: () => snapshotItemSize(input),
                apply: () => applyDashboardItemSize(input),
                commit: () => commitDashboardItemSize(input),
                rollback: (size) => rollbackItemSize(input, size),
                onError: (err) =>
                    toastRpcError(toast, err, 'Failed to update card size')
            });
            return true;
        } catch {
            return false;
        }
    }

    // Snapshot only the mutated item's size — a whole-row rollback would
    // revert other items' committed resizes.
    function snapshotItemSize(
        input: UpdateDashboardItemSizeInput
    ): DashboardItem['size'] | undefined {
        const items = dashboards.value[input.dashboardId]?.items ?? [];
        return items.find((item) => item.id === input.itemId)?.size;
    }

    function rollbackItemSize(
        input: UpdateDashboardItemSizeInput,
        size: DashboardItem['size'] | undefined
    ): void {
        if (size === undefined) return;
        applyDashboardItemSize({...input, size});
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
            dashboardsGuard.bump();
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
                dashboardsGuard.bump();
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

    // Item edits emit per mutation — collapse a burst into one fetch per id.
    const ITEMS_CHANGED_QUIET_MS = 400;
    const itemsChangedRefetch = createBatchCoalescer<number>((ids) => {
        for (const id of ids) void fetchOne(id);
    }, ITEMS_CHANGED_QUIET_MS);

    // Live updates — backend sends {id, name} or {id}; refetch the row.
    ws.onDashboardEvent((e) => {
        // OrderChanged is the odd one out — {userId, ids}, no dashboard id.
        if (e.method === DASHBOARD_EVENT.ORDER_CHANGED) {
            applyRemoteOrder(e.params);
            return;
        }
        const id = e.params.id as number | undefined;
        if (typeof id !== 'number') return;
        if (e.method === DASHBOARD_EVENT.DELETED) {
            dashboardsGuard.bump();
            const next = {...dashboards.value};
            delete next[id];
            dashboards.value = next;
            return;
        }
        if (e.method === DASHBOARD_EVENT.ITEMS_CHANGED) {
            itemsChangedRefetch.schedule(id);
            return;
        }
        void fetchOne(id);
    });

    // Reorder is per-user — apply only the current user's own order.
    function applyRemoteOrder(params: Record<string, unknown>): void {
        if (!Array.isArray(params.ids)) return;
        if (params.userId !== useAuthStore().username) return;
        useDashboardOrder().replace(params.ids as number[]);
    }

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
        clone
    };
});
