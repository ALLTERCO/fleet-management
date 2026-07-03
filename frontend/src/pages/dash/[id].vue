<template>
    <div v-if="!dashboard && loading" class="bento-grid p-4">
        <Skeleton v-for="n in 6" :key="n" variant="card" />
    </div>

    <div v-else-if="error">
        <span>Something went wrong</span>
    </div>

    <div v-else-if="!dashboard && !loading">
        <span>Dashboard not found</span>
    </div>

    <div v-else>
        <DashEditToolbar
            v-if="editMode"
            :can-undo="history.canUndo.value"
            :can-redo="history.canRedo.value"
            @add-widget="modals.addWidget = true"
            @undo="history.undo()"
            @redo="history.redo()"
            @save="saveEdit"
            @cancel="cancelEdit"
        />

        <div class="dash-header-row">
            <DashboardBreadcrumb />
        </div>

        <EmptyBlock
            v-if="dashboard!.items.length === 0"
            title="Dashboard is empty"
            description="Pin your most-used devices, groups, charts, or fleet KPIs here for at-a-glance access. You can rearrange and resize cards once they're in."
        >
            <template #icon>
                <i class="fas fa-table-cells-large" />
            </template>
            <template v-if="canEditDashboard" #action>
                <Button type="blue" @click="modals.addWidget = true">
                    Add widget
                </Button>
            </template>
            <template v-else #action>
                <p class="dash-empty-readonly">You have read-only access.</p>
            </template>
        </EmptyBlock>

        <ErrorBoundary v-if="dashboard!.items.length > 0">
        <BentoGrid ref="bentoGrid" :has-more="page < totalPages" :editing="editMode" @load-more="loadItems">
            <template v-for="(entry, entry_index) in items" :key="(entry as DashboardEntry).id ?? entry_index">
                <DashboardEntryView
                    :entry="(entry as DashboardEntry)"
                    :edit-mode="editMode"
                    :selected="selected === entry_index"
                    @delete="deleteEntry(entry_index)"
                    @move="(d: number) => moveEntry(entry_index, d)"
                    @cycle-size="cycleEntrySize(entry_index)"
                    @resize="(sz: string) => resizeEntry(entry_index, sz as CardSize)"
                    @open-detail="onEntryOpenDetail(entry as DashboardEntry, entry_index)"
                    @open-preview="onEntryOpenPreview(entry as DashboardEntry)"
                    @configure="openConfigure(entry_index)"
                />
            </template>

            <!-- Add Card placeholder (edit mode only) -->
            <button
                v-if="editMode && canEditDashboard"
                type="button"
                class="ec-add-card"
                title="Add widget"
                @click="modals.addWidget = true"
            >
                <i class="fas fa-plus" />
                <span>Add widget</span>
            </button>
        </BentoGrid>
        </ErrorBoundary>

        <div v-if="page < totalPages" class="mt-2 flex h-6 justify-center">
            <Spinner />
        </div>

        <WidgetConfigPanel
            v-if="configuringConfig !== null"
            :config="configuringConfig"
            @close="closeConfigure"
            @save="saveWidgetConfig"
        />
        <AddWidgetModal @added="widgetAdded" />
        <ShareDialog
            v-if="dashboard"
            :visible="shareVisible"
            resource-type="dashboard"
            :resource-id="dashboard.id"
            :resource-label="dashboard.name"
            @close="shareVisible = false"
            @shared="onShared"
        />
        <ConfirmationModal ref="modalRefDelete">
            <template #title>
                <h3>
                    You are about to delete a dashboard item!
                    <br />
                    Proceed?
                </h3>
            </template>
            <template #footer></template>
        </ConfirmationModal>

        <DetailOverlay
            v-if="detailEntity"
            :can-resize="canEditDashboard"
            :entity="detailEntity"
            :size="detailSize"
            :visible="detailVisible"
            @close="closeDetail"
            @update:size="updateDetailSize"
            @after-leave="clearDetail"
        />
    </div>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import {useSortable} from '@vueuse/integrations/useSortable';
import {storeToRefs} from 'pinia';
import {
    computed,
    onMounted,
    onUnmounted,
    provide,
    ref,
    watch,
    watchEffect
} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import BentoGrid from '@/components/cards/BentoGrid.vue';
import DetailOverlay from '@/components/cards/DetailOverlay.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import Skeleton from '@/components/core/Skeleton.vue';
import Spinner from '@/components/core/Spinner.vue';
import DashboardBreadcrumb from '@/components/dashboard/DashboardBreadcrumb.vue';
import DashboardEntryView from '@/components/dashboard/DashboardEntryView.vue';
import DashEditToolbar from '@/components/dashboard/DashEditToolbar.vue';
import WidgetConfigPanel from '@/components/dashboard/WidgetConfigPanel.vue';
import AddWidgetModal from '@/components/modals/AddWidgetModal.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import ShareDialog from '@/components/modals/ShareDialog.vue';
import {
    ACTIONS_LIST_KEY,
    ENTITY_CACHE_KEY
} from '@/composables/dashboardInjectionKeys';
import type {DashboardContext} from '@/composables/useDashboardContext';
import {DASHBOARD_CONTEXT_KEY} from '@/composables/useDashboardContext';
import {useDashboardHistory} from '@/composables/useDashboardHistory';
import {useDashboardNavigation} from '@/composables/useDashboardNavigation';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import useRegistry from '@/composables/useRegistry';
import {registerShortcut} from '@/config/shortcuts';
import {DASHBOARDS_PATH} from '@/constants';
import {ActionBoard} from '@/helpers/components';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {dashboardEditMode, modals} from '@/helpers/ui';
import {useAuthStore} from '@/stores/auth';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {type DashboardItem, useDashboardsStore} from '@/stores/dashboards';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import {getRegistry, sendRPC} from '@/tools/websocket';
import type {action_t, entity_t} from '@/types';
import type {CardSize, DashboardEntry} from '@/types/dashboard-entry';

// Card-to-component dispatch lives in composables/useDashboardEntryRenderer.
// Both this page and the add-widget catalog (CardPreview) use the same
// resolver — single source of truth for what renders on the dashboard.

const toast = useToastStore();
const authStore = useAuthStore();
const rpc = useRpcPermissions();
const canShare = computed(() => rpc.canCall('assignment.create'));
const canRevokeShare = computed(() => rpc.canCall('assignment.delete'));

const modalRefDelete = ref<InstanceType<typeof ConfirmationModal>>();

const route = useRoute('/dash/[id]');
const router = useRouter();
const id = computed(() => route.params.id);

const chartRefreshSignal = ref(0);

const dashboardContext = computed<DashboardContext>(() => {
    const raw = route.query.locationId ?? route.query.siteId;
    const parsed = Number(Array.isArray(raw) ? raw[0] : raw) || null;
    return {locationId: parsed, refreshSignal: chartRefreshSignal};
});
provide(DASHBOARD_CONTEXT_KEY, dashboardContext);

const dashboardsStore = useDashboardsStore();
const loading = computed(() => dashboardsStore.loading);
const error = ref(false);
const hasAttemptedDashboardLoad = ref(false);

function refresh() {
    return dashboardsStore.fetchAll();
}

function onRefresh(): void {
    void refresh();
    loadItems();
    chartRefreshSignal.value++;
}

function enterEditMode(): void {
    dashboardEditMode.value = true;
}

const {goToManage} = useDashboardNavigation();

const canEditDashboard = computed(() => {
    const dashId = Number(dashboard.value?.id ?? id.value);
    return (
        Number.isFinite(dashId) &&
        authStore.canPerformComponent('dashboards', 'update', dashId)
    );
});

const {
    data: actionsRaw,
    error: actionsError,
    loading: actionsLoading,
    refresh: actionsRefresh
} = useRegistry<action_t[]>('actions', 'rpc');
const actions = computed(() => actionsRaw.value || []);

// Expose to CardPreview consumers (the add-widget catalog previews use
// the same resolver and need the same actions list + entity cache).
provide(ACTIONS_LIST_KEY, actions);

const KNOWN_WIDGETS = new Set([
    'chart_widget',
    'gauge_widget',
    'stats_summary_widget',
    'top_consumers_widget',
    'state_timeline_widget',
    'activity_heatmap_widget',
    'energy_flow_sankey_widget',
    'fleet_kpi_strip_widget',
    'site_grid_widget',
    'maintenance_list_widget',
    'cross_site_bar_widget',
    'data_table_widget'
]);

// Backend kind enum → template's `type` axis (existing branches use this name).
function kindToEntryType(kind: string): DashboardEntry['type'] {
    switch (kind) {
        case 'device':
        case 'entity':
        case 'group':
        case 'location':
        case 'tag':
        case 'action':
            return kind;
        case 'widget':
            return 'ui_widget';
        default:
            return 'unknown';
    }
}

// Backend DashboardItem (Phase 2 typed + legacy fallbacks) → in-memory DashboardEntry.
function mapItem(it: DashboardItem): DashboardEntry {
    const size = (it.size as CardSize) || '1x1';
    const entryType = kindToEntryType(it.kind);

    if (entryType === 'entity') {
        return {
            id: it.id,
            type: 'entity',
            size,
            data: {id: it.entitySubId, device: it.deviceId ?? 0}
        };
    }
    if (entryType === 'device') {
        return {
            id: it.id,
            type: 'device',
            size,
            data: {id: it.deviceId ?? 0, subId: null}
        };
    }
    if (entryType === 'group') {
        return {
            id: it.id,
            type: 'group',
            size,
            data: {id: it.groupId ?? 0, subId: null}
        };
    }
    if (entryType === 'location') {
        return {
            id: it.id,
            type: 'location',
            size,
            data: {id: it.locationId ?? 0, subId: null}
        };
    }
    if (entryType === 'tag') {
        return {
            id: it.id,
            type: 'tag',
            size,
            data: {id: it.tagId ?? 0, subId: null}
        };
    }
    if (entryType === 'action') {
        return {
            id: it.id,
            type: 'action',
            size,
            data: {id: String(it.actionId ?? 0), subId: null}
        };
    }
    if (entryType === 'ui_widget') {
        if (it.widgetKind && KNOWN_WIDGETS.has(it.widgetKind)) {
            const cfg = it.widgetConfig
                ? {id: it.widgetKind, ...it.widgetConfig}
                : {id: it.widgetKind};
            return {id: it.id, type: 'ui_widget', size, data: cfg};
        }
        return {
            id: it.id,
            type: 'ui_widget',
            size,
            data: {id: 'broken_widget', _raw: null}
        };
    }
    return {
        id: it.id,
        type: 'unknown',
        size,
        data: {id: 0, subId: null}
    };
}

const dashboard = ref<{
    id: number;
    name: string;
    items: any[];
    createdAt?: string;
    updatedAt?: string | null;
} | null>(null);

// Declared before the immediate:true watch below; syncDashboardFromStore
// clears them when a stale edit session survives navigation between dashboards.
const history = useDashboardHistory();
const pendingDeletes = new Set<number>();

function syncDashboardFromStore() {
    const target = Number(id.value);
    // Non-numeric id (e.g. /dash/analytics without a dashboard id reaching
    // this catch-all route) — bounce back to /dash rather than rendering a
    // dead-end "Dashboard not found".
    if (!Number.isFinite(target)) {
        router.replace(DASHBOARDS_PATH);
        return;
    }

    if (dashboardEditMode.value) {
        if (dashboard.value?.id === target) return;
        history.clear();
        pendingDeletes.clear();
        dashboardEditMode.value = false;
    }

    const record = dashboardsStore.dashboards[target];
    if (!record) {
        dashboard.value = null;
        // Only treat a missing id as stale after a list or targeted load.
        if (hasAttemptedDashboardLoad.value && !dashboardsStore.loading) {
            router.replace(DASHBOARDS_PATH);
        }
        return;
    }
    dashboard.value = {
        id: record.id,
        name: record.name,
        items: (record.items ?? []).map(mapItem),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
    };
}

watch([id, () => dashboardsStore.dashboards], syncDashboardFromStore, {
    immediate: true
});

const entityStore = useEntityStore();
const {version: entityVersion} = storeToRefs(entityStore);
const groupStore = useGroupsStore();
const deviceStore = useDevicesStore();
const rightSideStore = useRightSideMenuStore();

// Debounced version counter — coalesces rapid entity/device/group updates
// into a single widget grid re-render (500ms window). Prevents per-status-event
// re-computation when many devices update in quick succession.
// Tracks last-seen source versions to skip bumps when nothing relevant changed.
const debouncedVersion = ref(0);
let _dashDebounce: ReturnType<typeof setTimeout> | undefined;
let _chartRefreshTimer: ReturnType<typeof setInterval> | undefined;
let _lastEntityV = entityVersion.value;
let _lastDeviceV = deviceStore.devicesVersion;
let _lastGroupLoading = groupStore.loading;
watch(
    [
        () => entityVersion.value,
        () => deviceStore.devicesVersion,
        () => groupStore.loading
    ],
    ([eV, dV, gL]) => {
        if (
            eV === _lastEntityV &&
            dV === _lastDeviceV &&
            gL === _lastGroupLoading
        )
            return;
        _lastEntityV = eV;
        _lastDeviceV = dV;
        _lastGroupLoading = gL;
        clearTimeout(_dashDebounce);
        _dashDebounce = setTimeout(() => {
            debouncedVersion.value++;
        }, 500);
    },
    {flush: 'post'}
);

const dashboardItems = computed(() => {
    void debouncedVersion.value;
    return (dashboard.value?.items ?? []).slice();
});

// Pre-computed entity metadata cache — avoids repeated store lookups in the template.
// Keyed by entry data ID, stores the resolved entity and its type string.
const entityCache = computed<Map<string, {entity: entity_t; type: string}>>(
    () => {
        void debouncedVersion.value;
        const map = new Map<string, {entity: entity_t; type: string}>();
        const items = dashboard.value?.items;
        if (!items) return map;
        for (const item of items) {
            if (item.type !== 'entity') continue;
            const id = item.data?.id;
            if (!id || map.has(id)) continue;
            const ent = entityStore.entities[id];
            if (ent) map.set(id, {entity: ent, type: ent.type});
        }
        return map;
    }
);

provide(ENTITY_CACHE_KEY, entityCache);

// Scale page size to screen: ~2x visible grid capacity so first scroll is instant,
// but don't over-allocate on small screens like Wall Display X2i (1440×720).
const pageSize = Math.max(
    12,
    Math.min(
        75,
        Math.floor((window.innerWidth * window.innerHeight) / (200 * 200))
    )
);

const {
    items,
    page,
    totalPages,
    loading: scrollLoading,
    loadItems
} = useInfiniteScroll(dashboardItems, pageSize);
const selected = ref<number>(-1);

// Detail overlay state
const detailEntity = ref<entity_t | null>(null);
const detailSize = ref<CardSize>('1x1');
const detailVisible = ref(false);
const detailEntryIndex = ref(-1);

watch(
    () => rightSideStore.inspectorComponent,
    (comp) => {
        if (!comp) selected.value = -1;
    }
);

const editMode = dashboardEditMode;
const shareVisible = ref(false);
function onShared(): void {
    /* Dialog refreshes its own share list internally on @shared. */
}
const selectedCards = ref(new Set<number>());

function deleteEntry(index: number) {
    if (!modalRefDelete.value || !dashboard.value) return;
    const dash = dashboard.value;
    const entry = dash.items[index];

    modalRefDelete.value?.storeAction(async () => {
        history.execute({
            type: 'delete',
            label: 'Delete card',
            redo: () => {
                // Find by identity — index may be stale if items were reordered
                // between the delete click and the modal confirmation.
                const idx = dash.items.indexOf(entry);
                if (idx !== -1) {
                    dash.items.splice(idx, 1);
                    if (entry.id != null) pendingDeletes.add(entry.id);
                }
            },
            undo: () => {
                // Re-insert as close to the original position as possible.
                const insertAt = Math.min(index, dash.items.length);
                dash.items.splice(insertAt, 0, entry);
                if (entry.id != null) pendingDeletes.delete(entry.id);
            }
        });
    });
}

// Default canvas sizes for each known widget kind.
const UI_WIDGET_SIZES: Record<string, string> = {
    chart_widget: '2x1',
    stats_summary_widget: '2x1',
    top_consumers_widget: '2x1',
    state_timeline_widget: '2x2',
    activity_heatmap_widget: '2x2',
    energy_flow_sankey_widget: '2x2',
    gauge_widget: '1x1',
    fleet_kpi_strip_widget: '2x1',
    site_grid_widget: '2x2',
    maintenance_list_widget: '2x1',
    cross_site_bar_widget: '2x1',
    data_table_widget: '2x2'
};

// Phase 2 wire format: {kind, refId, subItem?}. Backend returns the updated
// Dashboard — we use the last item from it instead of a second fetch.
async function addSimpleWidget(
    dashId: number,
    typeKey: 'action' | 'group' | 'location' | 'tag' | 'ui_widget',
    item: {data: any},
    order: number
): Promise<DashboardEntry> {
    const rpc = getRegistry('ui').addItem;
    const isConfigWidget =
        typeKey === 'ui_widget' &&
        item.data?.id &&
        item.data.id !== 'clock_widget';
    const size =
        (isConfigWidget ? UI_WIDGET_SIZES[item.data.id] : undefined) ?? '1x1';

    const refId = typeKey === 'ui_widget' ? 0 : Number(item.data.id) || 0;
    const fields: Record<string, unknown> = {
        dashboardId: dashId,
        kind: typeKey === 'ui_widget' ? 'widget' : typeKey,
        order,
        size
    };
    if (typeKey === 'ui_widget') {
        if (item.data?.id) {
            const {id, ...config} = item.data;
            fields.widgetKind = id;
            if (Object.keys(config).length > 0) fields.widgetConfig = config;
        }
    } else if (typeKey === 'action') {
        fields.actionId = refId;
    } else if (typeKey === 'group') {
        fields.groupId = refId;
    } else if (typeKey === 'location') {
        fields.locationId = refId;
    } else if (typeKey === 'tag') {
        fields.tagId = refId;
    }

    const updated = (await rpc('dashboards', fields as never)) as
        | {items?: DashboardItem[]}
        | undefined;

    const last = updated?.items?.[updated.items.length - 1];
    if (last) return mapItem(last);

    const entryType: DashboardEntry['type'] =
        typeKey === 'ui_widget' ? 'ui_widget' : typeKey;
    return {
        type: entryType,
        size: size as CardSize,
        data: isConfigWidget
            ? item.data
            : typeKey === 'action'
              ? {id: String(refId), subId: null}
              : {id: refId, subId: null}
    };
}

async function addEntityWidgets(
    dashId: number,
    ids: string[],
    sizes?: Record<string, string>
): Promise<DashboardEntry[]> {
    const rpc = getRegistry('ui').addItem;
    const added: DashboardEntry[] = [];
    // Local counter — dashboard.value.items doesn't update between iterations.
    let order = dashboard.value!.items.length;
    for (const fullId of ids) {
        const entity = entityStore.entities[fullId];
        const source = entity?.source;
        const device = source ? deviceStore.devices[source] : undefined;
        if (!device) {
            toast.error(`Device for "${fullId}" not found`);
            continue;
        }
        const size = sizes?.[fullId] ?? '1x1';
        const updated = (await rpc('dashboards', {
            dashboardId: dashId,
            kind: 'entity',
            deviceId: device.id,
            entitySubId: fullId,
            order: order++,
            size
        })) as {items?: DashboardItem[]} | undefined;
        // Pick the just-added (last) item so entry carries its persisted id.
        const last = updated?.items?.[updated.items.length - 1];
        if (last) {
            added.push(mapItem(last));
        } else {
            added.push({
                type: 'entity',
                size: size as CardSize,
                data: {id: fullId, device: device.id}
            });
        }
    }
    return added;
}

async function widgetAdded(item: {
    type: 'entities' | 'group' | 'location' | 'tag' | 'action' | 'ui_widget';
    data: any;
}) {
    modals.addWidget = false;
    if (!dashboard.value) return;

    const dashId = dashboard.value.id;
    let newItems: any[];

    if (item.type === 'entities') {
        newItems = await addEntityWidgets(
            dashId,
            [...item.data.ids],
            item.data.sizes
        );
    } else {
        const newItem = await addSimpleWidget(
            dashId,
            item.type,
            item,
            dashboard.value.items.length
        );
        newItems = [newItem];
    }

    // Push new items directly to preserve any unsaved drag-reorder state in
    // edit mode. A full refresh() would re-fetch the server's order and wipe
    // the user's in-progress rearrangement.
    dashboard.value.items.push(...newItems);
    loadItems();
}

function entityClicked(index: number, entity: entity_t) {
    selected.value = index;
    detailEntity.value = entity;
    detailEntryIndex.value = index;
    detailSize.value =
        (dashboard.value?.items[index]?.size as CardSize) || '1x1';
    detailVisible.value = true;
}

function closeDetail() {
    detailVisible.value = false;
}

function clearDetail() {
    detailEntity.value = null;
    detailEntryIndex.value = -1;
}

// Backend requires itemId>=1; the loose `==null` check let 0/NaN through
// and surfaced as a confusing Sql error. Validate at the boundary.
function isPersistedId(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

async function updateDetailSize(newSize: CardSize) {
    const entry = dashboard.value?.items[detailEntryIndex.value];
    if (!entry) return;
    const dashboardId = dashboard.value?.id;
    if (!isPersistedId(dashboardId)) return;
    if (!isPersistedId(entry.id)) {
        toast.error("Widget hasn't been saved yet — try again in a moment");
        return;
    }
    const prevSize = entry.size as CardSize;
    detailSize.value = newSize;
    const ok = await dashboardsStore.updateItemSize({
        dashboardId,
        itemId: entry.id,
        size: newSize
    });
    if (!ok) {
        detailSize.value = prevSize;
    }
}

const SIZE_CYCLE: CardSize[] = ['1x1', '2x1', '2x2'];

function cycleEntrySize(index: number) {
    const entry = dashboard.value?.items[index];
    if (!entry) return;
    const curr = (entry.size as CardSize) || '1x1';
    const next = SIZE_CYCLE[(SIZE_CYCLE.indexOf(curr) + 1) % SIZE_CYCLE.length];

    history.execute({
        type: 'resize',
        label: `Resize to ${next}`,
        redo: () => {
            entry.size = next;
        },
        undo: () => {
            entry.size = curr;
        }
    });
}

function resizeEntry(index: number, newSize: CardSize) {
    if (!dashboard.value) return;
    const entry = dashboard.value.items[index];
    if (!entry) return;
    const prev = (entry.size as CardSize) || '1x1';
    if (prev === newSize) return;

    const setSize = (size: CardSize) => {
        const arr = dashboard.value?.items;
        if (!arr) return;
        const i = arr.indexOf(entry);
        if (i < 0) return;
        arr.splice(i, 1, {...entry, size});
    };

    history.execute({
        type: 'resize',
        label: `Resize to ${newSize}`,
        redo: () => setSize(newSize),
        undo: () => setSize(prev)
    });
}

// `to` is the desired FINAL index of the moved card in the array (not an
// insert-before position). Both callers — the arrow buttons and drag-drop —
// pass the target slot directly; the redo/undo splices remove-then-insert so
// the element lands at exactly `to` regardless of move direction.
function reorderItems(from: number, to: number) {
    if (!dashboard.value) return;
    const arr = dashboard.value.items;
    if (from < 0 || from >= arr.length) return;
    const clampedTo = Math.max(0, Math.min(to, arr.length - 1));
    if (from === clampedTo) return;

    // Capture item reference — index may be stale after other undo/redo ops
    const movedItem = arr[from];
    const originalFrom = from;
    const originalTo = clampedTo;

    history.execute({
        type: 'move',
        label: 'Move card',
        redo: () => {
            const currentIdx = arr.indexOf(movedItem);
            if (currentIdx === -1) return;
            arr.splice(currentIdx, 1);
            arr.splice(Math.min(originalTo, arr.length), 0, movedItem);
        },
        undo: () => {
            const currentIdx = arr.indexOf(movedItem);
            if (currentIdx === -1) return;
            arr.splice(currentIdx, 1);
            arr.splice(Math.min(originalFrom, arr.length), 0, movedItem);
        }
    });
}

function moveEntry(index: number, direction: number) {
    reorderItems(index, index + direction);
}

// SortableJS via VueUse — long-press on touch (200ms) to start drag, keeps
// taps clickable. onUpdate fires after sortable mutates the array; we revert
// and route through reorderItems so moves go via the undo/redo history.
const bentoGrid = ref<{gridEl: HTMLElement | null} | null>(null);
const sortableEl = computed(() => bentoGrid.value?.gridEl ?? null);
const sortableItems = computed(() => dashboard.value?.items ?? []);
const sortable = useSortable(sortableEl, sortableItems, {
    animation: 150,
    delay: 200,
    delayOnTouchOnly: true,
    ghostClass: 'dragging',
    // Drag-to-reorder is disabled by product decision: dashboard items keep
    // their add-order; users can only add and remove (and resize). Kept the
    // sortable wiring inert rather than ripping it out.
    disabled: true,
    onUpdate(e: {
        oldIndex?: number;
        newIndex?: number;
        item?: HTMLElement;
        from?: HTMLElement;
    }) {
        const oldIndex = e.oldIndex;
        const newIndex = e.newIndex;
        if (oldIndex == null || newIndex == null || oldIndex === newIndex)
            return;
        const arr = dashboard.value?.items;
        if (!arr) return;
        // We supply our own onUpdate, so VueUse's array-sync is disabled and
        // the model is untouched here — only the DOM was reordered by
        // SortableJS. Revert that DOM move so Vue can re-render from the model
        // (the source of truth), then apply the move via the undo/redo history.
        const node = e.item;
        const parent = e.from;
        if (node && parent) {
            node.parentNode?.removeChild(node);
            parent.insertBefore(node, parent.children[oldIndex] ?? null);
        }
        // Drags that start on a non-card child are not real reorders.
        if (oldIndex >= arr.length) return;
        // The Add-widget button and load-more sentinel share the grid and sit
        // after the cards; clamp the drop target into the item range so we
        // never index a non-item slot (which previously spliced `undefined`
        // into the model and crashed the render).
        reorderItems(oldIndex, Math.min(newIndex, arr.length - 1));
    }
});
// Keep sortable permanently disabled regardless of edit mode.
watch(dashboardEditMode, () => sortable.option('disabled', true));

function cancelEdit() {
    history.clear();
    pendingDeletes.clear();
    dashboardEditMode.value = false;
    void refresh();
    loadItems();
}

// Convert the in-memory entry back to the typed wire shape Item.SetAll expects.
function unmapItem(item: DashboardEntry, order: number) {
    const base = {
        deviceId: null as number | null,
        entitySubId: null as string | null,
        groupId: null as number | null,
        locationId: null as number | null,
        tagId: null as number | null,
        actionId: null as number | null,
        widgetKind: null as string | null,
        widgetConfig: null as Record<string, unknown> | null,
        size: item.size ?? '1x1',
        order
    };
    if (item.type === 'entity') {
        return {
            ...base,
            kind: 'entity',
            deviceId: item.data?.device ?? null,
            entitySubId: item.data?.id ?? null
        };
    }
    if (item.type === 'device') {
        return {
            ...base,
            kind: 'device',
            deviceId: item.data?.id ?? item.data?.shellyID ?? null
        };
    }
    if (item.type === 'group') {
        return {
            ...base,
            kind: 'group',
            groupId: Number(item.data?.id) || null
        };
    }
    if (item.type === 'location') {
        return {
            ...base,
            kind: 'location',
            locationId: Number(item.data?.id) || null
        };
    }
    if (item.type === 'tag') {
        return {...base, kind: 'tag', tagId: Number(item.data?.id) || null};
    }
    if (item.type === 'action') {
        return {
            ...base,
            kind: 'action',
            actionId: Number(item.data?.id) || null
        };
    }
    if (item.type === 'ui_widget') {
        const id = item.data?.id;
        if (id && id !== 'broken_widget') {
            const {id: _, ...config} = item.data;
            return {
                ...base,
                kind: 'widget',
                widgetKind: id,
                widgetConfig: Object.keys(config).length > 0 ? config : null
            };
        }
    }
    return {...base, kind: 'widget'};
}

async function saveEdit() {
    if (dashboard.value) {
        try {
            const dashId = dashboard.value.id;
            // Remove widgets deleted during this edit session
            for (const itemId of pendingDeletes) {
                await getRegistry('ui').removeWidget('dashboards', {
                    dashboard: dashId,
                    itemId
                });
            }
            pendingDeletes.clear();
            // Persist the full item set (order + sizes + widget config) via the
            // dedicated dashboard RPC. The legacy Storage.SetItem fallback is
            // rejected by the backend for the 'dashboards' key. SetAll returns
            // the reconciled dashboard (items get fresh ids), so we rehydrate
            // local state from it rather than trusting our optimistic copy.
            const updated = await sendRPC<{
                id: number;
                name: string;
                items?: DashboardItem[];
            }>('FLEET_MANAGER', 'Dashboard.Item.SetAll', {
                dashboardId: dashId,
                items: dashboard.value.items.map((item: any, i: number) =>
                    unmapItem(item, i)
                )
            });
            dashboardsStore.upsert(updated as never);
            dashboard.value = {
                id: updated.id,
                name: updated.name,
                items: (updated.items ?? []).map(mapItem)
            };
            history.clear();
            dashboardEditMode.value = false;
        } catch (err) {
            console.error('Failed to save dashboard:', err);
            toast.error('Failed to save dashboard. Please try again.');
        }
    }
}

// ── Widget configure panel ──
const configuringIndex = ref<number | null>(null);
const configuringConfig = ref<Record<string, any> | null>(null);

function openConfigure(index: number) {
    const entry = dashboard.value?.items[index];
    if (!entry || entry.type !== 'ui_widget') return;
    configuringIndex.value = index;
    configuringConfig.value = {...entry.data};
}

function closeConfigure() {
    configuringIndex.value = null;
    configuringConfig.value = null;
}

async function saveWidgetConfig(updatedConfig: Record<string, any>) {
    const index = configuringIndex.value;
    if (index === null || !dashboard.value) return;
    const entry = dashboard.value.items[index];
    if (!entry) return;

    const prev = {...entry.data};
    entry.data = {...updatedConfig};

    try {
        const dashId = dashboard.value.id;
        await sendRPC('FLEET_MANAGER', 'Dashboard.Item.SetAll', {
            dashboardId: dashId,
            items: dashboard.value.items.map((item: any, i: number) =>
                unmapItem(item, i)
            )
        });
        closeConfigure();
    } catch {
        entry.data = prev;
        toast.error('Failed to save widget config');
    }
}

function actionClicked(index: number, actionID: string) {
    selected.value = index;
    rightSideStore.showInspector(ActionBoard, {actionID});
}

function gotoGroup(id: number) {
    router.push(`/organize/groups?preview=${id}`);
}

/** Bridges DashboardEntryView's open-detail event back to the right
 *  click handler for the entry type. */
function onEntryOpenDetail(entry: DashboardEntry, index: number) {
    if (editMode.value) return;
    if (entry.type === 'entity') {
        const ent =
            entityCache.value.get(entry.data.id)?.entity ??
            entityStore.entities[entry.data.id];
        if (ent) entityClicked(index, ent);
        return;
    }
    if (entry.type === 'action') {
        actionClicked(index, entry.data.id);
    }
}

function onEntryOpenPreview(entry: DashboardEntry) {
    if (editMode.value) return;
    if (entry.type === 'group') {
        gotoGroup(entry.data.id);
    }
}

const unregShortcuts: Array<() => void> = [];

onMounted(() => {
    unregShortcuts.push(
        registerShortcut({
            id: 'dashboard.undo',
            description: 'Undo',
            section: 'Dashboard edit',
            when: () => editMode.value,
            handler: (e) => {
                e.preventDefault();
                history.undo();
            }
        }),
        registerShortcut({
            id: 'dashboard.redo',
            description: 'Redo',
            section: 'Dashboard edit',
            when: () => editMode.value,
            handler: (e) => {
                e.preventDefault();
                history.redo();
            }
        })
    );
    if (Object.keys(dashboardsStore.dashboards).length === 0) {
        void dashboardsStore.fetchAll().finally(() => {
            hasAttemptedDashboardLoad.value = true;
            syncDashboardFromStore();
        });
    } else {
        const target = Number(id.value);
        if (!Number.isFinite(target)) return;
        if (dashboardsStore.dashboards[target]) {
            hasAttemptedDashboardLoad.value = true;
            void dashboardsStore.fetchOne(target);
        } else {
            void dashboardsStore.fetchOne(target).finally(() => {
                hasAttemptedDashboardLoad.value = true;
                syncDashboardFromStore();
            });
        }
    }
    _chartRefreshTimer = setInterval(
        () => {
            if (document.visibilityState === 'visible')
                chartRefreshSignal.value++;
        },
        5 * 60 * 1000
    );
});
onUnmounted(() => {
    for (const u of unregShortcuts) u();
    clearInterval(_chartRefreshTimer);
    clearTimeout(_dashDebounce);
    dashboardEditMode.value = false;
    detailVisible.value = false;
    detailEntity.value = null;
    rightSideStore.clearInspector();
    chrome.clear();
});

const chrome = useDashboardChromeStore();
watchEffect(() => {
    chrome.register({
        onRefresh,
        onShare: () => {
            shareVisible.value = true;
        },
        onToggleEdit: enterEditMode,
        onAddWidget: () => {
            modals.addWidget = true;
        },
        onOpenManage: goToManage,
        canEdit: canEditDashboard.value,
        canShare: canShare.value,
        loading: loading.value
    });
});
</script>

<style scoped>
/* Breadcrumb + Share button on one row, right-aligned button. */
.dash-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
}
.dash-shared {
    margin: var(--space-3) 0;
}
/* Read-only fallback shown in the EmptyBlock action slot. */
.dash-empty-readonly {
    margin: 0;
    font-size: var(--type-body);
    color: var(--color-warning-text);
}

/* ── Broken/missing widget placeholder ── */
.dash-broken {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--gap-xs);
    padding: var(--gap-sm);
}
.dash-broken__icon { font-size: var(--type-subheading); color: var(--color-warning-text); }
.dash-broken__text { font-size: var(--type-body); font-weight: 600; color: var(--color-text-secondary); text-align: center; }
.dash-broken__hint { font-size: var(--type-body); font-family: var(--font-mono); color: var(--color-text-quaternary); }
.dash-loading { display: flex; flex-direction: column; justify-content: center; height: 100%; padding: var(--gap-sm); }

/* ── Add Card placeholder cell (edit mode) ── */
.ec-add-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border: 2px dashed rgba(var(--color-primary-rgb), 0.35);
    border-radius: var(--radius-lg);
    background: rgba(var(--color-primary-rgb), 0.06);
    color: rgba(var(--color-primary-rgb), 0.7);
    font-size: var(--type-body);
    font-weight: 600;
    cursor: pointer;
    transition:
        background 0.2s,
        border-color 0.2s,
        color 0.2s;
}
.ec-add-card i {
    font-size: var(--type-subheading);
}
.ec-add-card:hover {
    background: rgba(var(--color-primary-rgb), 0.12);
    border-color: rgba(var(--color-primary-rgb), 0.6);
    color: var(--color-primary-text);
}
.ec-add-card:active {
    transform: scale(0.97);
}
</style>
