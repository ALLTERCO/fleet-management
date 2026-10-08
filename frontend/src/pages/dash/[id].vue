<template>
    <DashboardLoadingSkeleton
        v-if="!dashboard && loading"
        label="Loading dashboard controls"
    />

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
            @rename="renameVisible = true"
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
        <BentoGrid
            ref="bentoGrid"
            :has-more="page < totalPages"
            :editing="editMode"
            @load-more="loadItems"
            @layout-change="applyLayoutChange"
        >
            <!-- GridStack reads placement off these attributes. A null gs-x/gs-y
                 means "never positioned"; GridStack then flows the card by DOM
                 order, which is the migration's documented first-load behaviour. -->
            <div
                v-for="(entry, entry_index) in items"
                :key="(entry as DashboardEntry).id ?? entry_index"
                class="grid-stack-item"
                :gs-id="String((entry as DashboardEntry).id ?? entry_index)"
                :gs-x="(entry as DashboardEntry).gridX ?? undefined"
                :gs-y="(entry as DashboardEntry).gridY ?? undefined"
                :gs-w="footprintFor((entry as DashboardEntry).size).w"
                :gs-h="footprintFor((entry as DashboardEntry).size).h"
            >
                <div class="grid-stack-item-content">
                    <DashboardEntryView
                        :entry="(entry as DashboardEntry)"
                        :edit-mode="editMode"
                        :selected="selected === entry_index"
                        @delete="deleteEntry(entry_index)"
                        @cycle-size="cycleEntrySize(entry_index)"
                        @resize="(sz: string) => resizeEntry(entry_index, sz as CardSize)"
                        @open-detail="openEntryDetail(entry as DashboardEntry, entry_index)"
                        @open-preview="openEntryDetail(entry as DashboardEntry, entry_index)"
                        @configure="openConfigure(entry_index)"
                    />
                </div>
            </div>
        </BentoGrid>

        <!-- Outside the grid: GridStack owns its children's geometry, and a
             button that is not a card should not occupy a grid cell. -->
        <button
            v-if="editMode && canEditDashboard"
            type="button"
            class="ec-add-card ec-add-card--standalone"
            title="Add widget"
            @click="modals.addWidget = true"
        >
            <i class="fas fa-plus" />
            <span>Add widget</span>
        </button>
        </ErrorBoundary>

        <div v-if="page < totalPages" class="mt-2 flex h-6 justify-center">
            <Spinner />
        </div>

        <WidgetConfigPanel
            v-if="configuringConfig !== null"
            :config="configuringConfig"
            :size="configuringSize"
            @close="closeConfigure"
            @save="saveWidgetConfig"
        />
        <AddWidgetModal @added="widgetAdded" />
        <DashRenameModal
            :visible="renameVisible"
            :name="dashboard?.name ?? ''"
            :saving="renameSaving"
            @save="saveRename"
            @close="renameVisible = false"
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

        <DetailOverlayShell
            v-if="widgetDetail"
            :visible="widgetDetailVisible"
            data-type="ui_widget"
            @close="closeWidgetDetail"
            @after-leave="clearWidgetDetail"
        >
            <template #default="{close, titleId}">
                <WidgetDetailBody
                    :entry="widgetDetail.entry"
                    :title="widgetDetail.title"
                    :title-id="titleId"
                    @close="close"
                />
            </template>
        </DetailOverlayShell>
    </div>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
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
import DetailOverlayShell from '@/components/cards/DetailOverlayShell.vue';
import WidgetDetailBody from '@/components/cards/WidgetDetailBody.vue';
import Button from '@/components/core/Button.vue';
import EmptyBlock from '@/components/core/EmptyBlock.vue';
import ErrorBoundary from '@/components/core/ErrorBoundary.vue';
import Spinner from '@/components/core/Spinner.vue';
import DashboardBreadcrumb from '@/components/dashboard/DashboardBreadcrumb.vue';
import DashboardEntryView from '@/components/dashboard/DashboardEntryView.vue';
import DashboardLoadingSkeleton from '@/components/dashboard/DashboardLoadingSkeleton.vue';
import DashEditToolbar from '@/components/dashboard/DashEditToolbar.vue';
import DashRenameModal from '@/components/dashboard/DashRenameModal.vue';
import WidgetConfigPanel from '@/components/dashboard/WidgetConfigPanel.vue';
import AddWidgetModal from '@/components/modals/AddWidgetModal.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {
    ACTIONS_LIST_KEY,
    ENTITY_CACHE_KEY
} from '@/composables/dashboardInjectionKeys';
import type {DashboardContext} from '@/composables/useDashboardContext';
import {DASHBOARD_CONTEXT_KEY} from '@/composables/useDashboardContext';
import type {DetailResolverContext} from '@/composables/useDashboardDetailResolver';
import {resolveDashboardDetail} from '@/composables/useDashboardDetailResolver';
import {footprintFor, type GridMove} from '@/composables/useDashboardGrid';
import {useDashboardHistory} from '@/composables/useDashboardHistory';
import useInfiniteScroll from '@/composables/useInfiniteScroll';
import useRegistry from '@/composables/useRegistry';
import {
    unionComponents,
    unionToSub
} from '@/composables/useVisibleDeviceComponents';
import {registerShortcut} from '@/config/shortcuts';
import {DASHBOARDS_PATH} from '@/constants';
import {ActionBoard, DeviceBoard} from '@/helpers/components';
import {useRpcPermissions} from '@/helpers/rpcPermissions';
import {dashboardEditMode, modals} from '@/helpers/ui';
import {
    defaultSizeForWidget,
    nextSizeForEntity
} from '@/helpers/widgetCatalog';
import {CATALOG_UI_WIDGETS} from '@/helpers/widgetSamples';
import {useAuthStore} from '@/stores/auth';
import {useDashboardChromeStore} from '@/stores/dashboardChrome';
import {type DashboardItem, useDashboardsStore} from '@/stores/dashboards';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useRightSideMenuStore} from '@/stores/right-side';
import {useToastStore} from '@/stores/toast';
import {
    getRegistry,
    sendRPC,
    setDeviceComponentSubscription
} from '@/tools/websocket';
import type {action_t, entity_t} from '@/types';
import type {CardSize, DashboardEntry} from '@/types/dashboard-entry';

// Card-to-component dispatch lives in composables/useDashboardEntryRenderer.
// Both this page and the add-widget catalog (CardPreview) use the same
// resolver — single source of truth for what renders on the dashboard.

const toast = useToastStore();
const authStore = useAuthStore();
const rpcPermissions = useRpcPermissions();

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

// Bento rename — the ⋮ "Edit dashboard" enters layout mode; the toolbar's
// Rename button opens this modal so a bento (incl. the default) can be renamed.
const renameVisible = ref(false);
const renameSaving = ref(false);

async function saveRename(name: string): Promise<void> {
    const target = Number(dashboard.value?.id ?? id.value);
    if (!Number.isFinite(target)) return;
    renameSaving.value = true;
    try {
        const updated = await dashboardsStore.update(target, {name});
        if (updated) {
            if (dashboard.value) dashboard.value.name = updated.name ?? name;
            renameVisible.value = false;
        }
    } finally {
        renameSaving.value = false;
    }
}

function refresh() {
    return dashboardsStore.fetchAll();
}

function enterEditMode(): void {
    dashboardEditMode.value = true;
}

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

// Derived from the catalog, never a second list: the two drifted once and every
// clock item became "Widget config invalid".
const KNOWN_WIDGETS = new Set<string>(CATALOG_UI_WIDGETS);

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

// Widget data contract: tell the backend which device components this
// dashboard shows, so it streams live values (incl. power/consumption) for
// exactly these devices and components. Debounced + auto-restored on reconnect
// inside setDeviceComponentSubscription.
watch(
    entityCache,
    (cache) => {
        const entities = Array.from(cache.values(), (c) => c.entity);
        setDeviceComponentSubscription(unionToSub(unionComponents(entities)));
    },
    {immediate: true}
);

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

// Detail overlay state (entity tiles)
const detailEntity = ref<entity_t | null>(null);
const detailSize = ref<CardSize>('1x1');
const detailVisible = ref(false);
const detailEntryIndex = ref(-1);

// Detail overlay state (ui_widget tiles) — same shell, widget body.
const widgetDetail = ref<{entry: DashboardEntry; title: string} | null>(null);
const widgetDetailVisible = ref(false);

watch(
    () => rightSideStore.inspectorComponent,
    (comp) => {
        if (!comp) selected.value = -1;
    }
);

const editMode = dashboardEditMode;
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

// Phase 2 wire format: {kind, refId, subItem?}. Backend returns the updated
// Dashboard — we use the last item from it instead of a second fetch.
async function addSimpleWidget(
    dashId: number,
    typeKey: 'action' | 'group' | 'location' | 'tag' | 'ui_widget',
    item: {data: any},
    order: number
): Promise<DashboardEntry> {
    const rpc = getRegistry('ui').addItem;
    const size =
        typeKey === 'ui_widget'
            ? defaultSizeForWidget(item.data?.id)
            : '1x1';

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
        data: typeKey === 'ui_widget'
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

// Entity behind an entry, when it is an entity tile — drives the size rule
// (battery tiles cap at 2x1). Other entry kinds have no single entity.
function entityForEntry(entry: DashboardEntry): entity_t | undefined {
    if (entry.type !== 'entity') return undefined;
    return entityStore.entities[entry.data?.id];
}

function cycleEntrySize(index: number) {
    const entry = dashboard.value?.items[index];
    if (!entry) return;
    const curr = (entry.size as CardSize) || '1x1';
    const next = nextSizeForEntity(curr, entityForEntry(entry));

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

// GridStack reports every card whose placement changed after a drag. Applying
// them through the history keeps undo/redo working the same as add and resize.
function applyLayoutChange(moves: GridMove[]) {
    if (!dashboard.value || !moves.length) return;
    const arr = dashboard.value.items as DashboardEntry[];
    const targets = moves
        .map((move) => ({
            move,
            entry: arr.find((it) => String(it.id) === move.id)
        }))
        .filter((t): t is {move: GridMove; entry: DashboardEntry} => !!t.entry);
    if (!targets.length) return;

    const before = targets.map((t) => ({
        entry: t.entry,
        gridX: t.entry.gridX ?? null,
        gridY: t.entry.gridY ?? null
    }));
    // Nothing actually moved — GridStack also fires on its own reflow.
    if (
        before.every(
            (b, i) =>
                b.gridX === targets[i].move.x && b.gridY === targets[i].move.y
        )
    )
        return;

    history.execute({
        type: 'move',
        label: targets.length > 1 ? 'Move cards' : 'Move card',
        redo: () => {
            for (const {move, entry} of targets) {
                entry.gridX = move.x;
                entry.gridY = move.y;
            }
        },
        undo: () => {
            for (const b of before) {
                b.entry.gridX = b.gridX;
                b.entry.gridY = b.gridY;
            }
        }
    });
}

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
const configuringSize = ref<CardSize>('1x1');

function openConfigure(index: number) {
    const entry = dashboard.value?.items[index];
    if (!entry || entry.type !== 'ui_widget') return;
    configuringIndex.value = index;
    configuringConfig.value = {...entry.data};
    configuringSize.value = entry.size;
}

function closeConfigure() {
    configuringIndex.value = null;
    configuringConfig.value = null;
}

async function saveWidgetConfig(payload: {
    config: Record<string, unknown>;
    size: CardSize;
}) {
    const index = configuringIndex.value;
    if (index === null || !dashboard.value) return;
    const entry = dashboard.value.items[index];
    if (!entry) return;

    const prev = {data: {...entry.data}, size: entry.size};
    entry.data = {...payload.config};
    entry.size = payload.size;

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
        entry.data = prev.data;
        entry.size = prev.size;
        toast.error('Failed to save widget config');
    }
}

function actionClicked(index: number, actionID: string) {
    selected.value = index;
    rightSideStore.showInspector(ActionBoard, {actionID});
}

// Same inspector call the devices page uses for a card click.
function deviceClicked(index: number, shellyID: string) {
    selected.value = index;
    rightSideStore.showInspector(DeviceBoard, {shellyID});
}

function gotoGroup(id: number) {
    router.push(`/organize/groups?preview=${id}`);
}

function gotoLocation(id: number) {
    router.push(`/organize/locations?preview=${id}`);
}

function gotoTag(id: number) {
    router.push(`/organize/tags?preview=${id}`);
}

function openWidgetDetail(entry: DashboardEntry, title: string) {
    widgetDetail.value = {entry, title};
    widgetDetailVisible.value = true;
}

function closeWidgetDetail() {
    widgetDetailVisible.value = false;
}

function clearWidgetDetail() {
    widgetDetail.value = null;
}

// Context for the click-detail resolver — the same lookups the render path
// uses, plus device presence (the inspector needs a loaded device record).
function detailResolverCtx(): DetailResolverContext {
    return {
        entityCache: entityCache.value,
        rawEntity: (entityId) => entityStore.entities[entityId],
        group: (groupId) => groupStore.groups[groupId],
        action: (actionId) => actions.value.find((a) => a.id === actionId),
        deviceExternalId: (deviceId) => deviceStore.idToShellyMap.get(deviceId),
        device: (shellyID) => deviceStore.devices[shellyID]
    };
}

/** One resolver-driven entry point for every card click (open-detail and
 *  open-preview both land here) — replaces the old per-type whitelists. */
function openEntryDetail(entry: DashboardEntry, index: number) {
    if (editMode.value) return;
    const detail = resolveDashboardDetail(entry, detailResolverCtx());
    if (!detail) return;
    switch (detail.kind) {
        case 'entity':
            entityClicked(index, detail.entity);
            return;
        case 'action':
            actionClicked(index, detail.actionId);
            return;
        case 'device':
            deviceClicked(index, detail.deviceId);
            return;
        case 'group':
            gotoGroup(detail.groupId);
            return;
        case 'location':
            gotoLocation(detail.locationId);
            return;
        case 'tag':
            gotoTag(detail.tagId);
            return;
        case 'widget':
            openWidgetDetail(entry, detail.title);
            return;
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
    widgetDetailVisible.value = false;
    widgetDetail.value = null;
    rightSideStore.clearInspector();
    chrome.clear();
    // Drop this dashboard's scoped component subscription.
    setDeviceComponentSubscription(null);
});

const chrome = useDashboardChromeStore();
const canCreateDashboard = computed(() =>
    authStore.hasComponentPermission('dashboards', 'create')
);
const isDefaultDash = computed(() =>
    Boolean(dashboardsStore.dashboards[Number(id.value)]?.isDefault)
);

async function setAsDefault(): Promise<void> {
    const dashId = Number(id.value);
    if (Number.isFinite(dashId)) await dashboardsStore.setDefault(dashId);
}

// Duplicate copies the layout into a fresh classic dashboard, then opens it.
async function duplicateDashboard(): Promise<void> {
    const dash = dashboard.value;
    if (!dash) return;
    const copy = await dashboardsStore.clone(dash.id, `${dash.name} copy`);
    if (copy) router.push({name: '/dash/[id]', params: {id: copy.id}});
}

watchEffect(() => {
    chrome.register({
        kind: 'bento',
        onEdit: enterEditMode,
        onSetDefault: () => void setAsDefault(),
        onDuplicate: canCreateDashboard.value
            ? () => void duplicateDashboard()
            : undefined,
        canEdit: canEditDashboard.value,
        canShare: rpcPermissions.canCall('assignment.create'),
        isDefault: isDefaultDash.value,
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
