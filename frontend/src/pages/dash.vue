<template>
    <div class="relative flex min-h-0 flex-1 flex-col">
        <DashPillBar
            :dashboards="pillDashboards"
            :active-id="activeDashId"
            :loading="dashboardsStore.loading"
            @select="onPillSelect"
            @open-palette="openPalette"
        />

        <!-- Child route content (e.g. /dash/:id) -->
        <RouterView v-slot="{ Component }">
            <component :is="Component" :key="$route.path" />
        </RouterView>

        <DashboardPalette
            :visible="paletteOpen"
            :initial-mode="paletteInitialMode"
            :rows="paletteRows"
            :active-id="activeDashId || null"
            :recent-ids="recentIds"
            :can-create="canCreateDashboard"
            :creating="creating"
            :can-rename="canUpdateDashboard"
            :can-delete="canDeleteDashboard"
            @close="closePalette"
            @open="onPaletteOpenDashboard"
            @create="onPaletteCreate"
            @rename="onPaletteRename"
            @delete="onPaletteDelete"
            @move="onPaletteMove"
        />
    </div>
</template>

<script setup lang="ts">
import {computed, onMounted, provide, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import DashboardPalette from '@/components/dashboard/DashboardPalette.vue';
import type {CreateSubmitPayload} from '@/components/dashboard/DashboardPaletteCreate.vue';
import type {DashPillItem} from '@/components/dashboard/DashPillBar.vue';
import DashPillBar from '@/components/dashboard/DashPillBar.vue';
import {useDashboardOrder} from '@/composables/useDashboardOrder';
import {useKeyboardShortcuts} from '@/composables/useKeyboardShortcuts';
import {useRecentDashboards} from '@/composables/useRecentDashboards';
import {DASHBOARDS_PATH} from '@/constants';
import {
    OPEN_DASHBOARD_PALETTE_KEY,
    type OpenDashboardPaletteOptions
} from '@/helpers/dashboardKeys';
import {isDefaultDashboard} from '@/helpers/dashboardOrder';
import type {PaletteRow} from '@/helpers/dashboardPalette';
import {toastRpcError} from '@/helpers/domainErrors';
import {useAnalyticsStore} from '@/stores/analytics';
import {useAuthStore} from '@/stores/auth';
import {type Dashboard, useDashboardsStore} from '@/stores/dashboards';
import {useToastStore} from '@/stores/toast';
import {DOMAIN_TYPES} from '@/types/dashboard';

const route = useRoute();
const router = useRouter();
const dashboardsStore = useDashboardsStore();
const analyticsStore = useAnalyticsStore();
const authStore = useAuthStore();
const toast = useToastStore();
const recents = useRecentDashboards({
    scopeKey: () => authStore.currentUserId
});

const ROUTED_TYPES = ['analytics', ...DOMAIN_TYPES] as const;

const paletteOpen = ref(false);
const paletteInitialMode = ref<'list' | 'create'>('list');
// One symbol identifies the in-flight create. closePalette nulls it to
// orphan side effects; the finally block only resets if the symbol still
// matches its own token, so a stale RPC never unlocks a later create.
const creatingToken = ref<symbol | null>(null);
const creating = computed(() => creatingToken.value !== null);

const order = useDashboardOrder();

const sortedDashboards = computed<Dashboard[]>(() => {
    const all = Object.values(dashboardsStore.dashboards);
    const saved = order.ids.value;
    if (saved.length === 0) {
        return all.sort((a, b) => Number(a.id) - Number(b.id));
    }
    const byId = new Map(all.map((d) => [String(d.id), d]));
    const seen = new Set<string>();
    const ordered: Dashboard[] = [];
    for (const id of saved) {
        const dash = byId.get(String(id));
        if (dash) {
            ordered.push(dash);
            seen.add(String(id));
        }
    }
    for (const dash of all) {
        if (!seen.has(String(dash.id))) ordered.push(dash);
    }
    return ordered;
});

const pillDashboards = computed<DashPillItem[]>(() =>
    sortedDashboards.value.map((dash) => {
        const {id, name, color} = dash as Dashboard & {color?: string};
        return {id, name, color};
    })
);

const paletteRows = computed<PaletteRow[]>(() =>
    sortedDashboards.value.map((dash) => ({
        id: dash.id,
        name: dash.name,
        type: (dash.dashboardType ?? 'classic') as PaletteRow['type'],
        widgetCount: dash.items?.length ?? 0,
        color: (dash as Dashboard & {color?: string}).color,
        isPinned: Boolean(dash.isPinned),
        isDefault: isDefaultDashboard(dash.id) || Boolean(dash.isDefault)
    }))
);

const activeDashId = computed<number | string>(() => {
    const prefixes = ROUTED_TYPES.map((t) => `${t}\\/`).join('|');
    const re = new RegExp(`\\/dash\\/(?:${prefixes})?(\\d+)`);
    const match = route.path.match(re);
    return match?.[1] ? Number(match[1]) : '';
});

const recentIds = computed(() => recents.ids.value);

const canCreateDashboard = computed(() =>
    authStore.hasComponentPermission('dashboards', 'create')
);

function canUpdateDashboard(id: number | string): boolean {
    const dashId = Number(id);
    return (
        Number.isFinite(dashId) &&
        authStore.canPerformComponent('dashboards', 'update', dashId)
    );
}

function canDeleteDashboard(id: number | string): boolean {
    const dashId = Number(id);
    return (
        Number.isFinite(dashId) &&
        authStore.canPerformComponent('dashboards', 'delete', dashId)
    );
}

// 'classic' is the only non-routed type we recognise; anything else with
// an unknown type is a server contract drift — fall back to classic but log
// so we know to add the route mapping.
function getDashboardRoute(dashboard: {
    id: number | string;
    dashboardType?: string;
}): string {
    const type = dashboard.dashboardType;
    if (type && (ROUTED_TYPES as readonly string[]).includes(type)) {
        return `/dash/${type}/${dashboard.id}`;
    }
    if (type && type !== 'classic') {
        console.warn(
            `[dashboards] unknown dashboardType "${type}" — routing to classic`
        );
    }
    return `/dash/${dashboard.id}`;
}

function onPillSelect(id: number | string): void {
    const dash = sortedDashboards.value.find(
        (d) => String(d.id) === String(id)
    );
    if (!dash) return;
    router.push(getDashboardRoute(dash));
}

function openPalette(options: OpenDashboardPaletteOptions = {}): void {
    paletteInitialMode.value = options.mode ?? 'list';
    paletteOpen.value = true;
}

function closePalette(): void {
    paletteOpen.value = false;
    paletteInitialMode.value = 'list';
    creatingToken.value = null;
}

provide(OPEN_DASHBOARD_PALETTE_KEY, openPalette);

function onPaletteOpenDashboard(id: number | string): void {
    const dash = sortedDashboards.value.find(
        (d) => String(d.id) === String(id)
    );
    if (!dash) return;
    recents.touch(id);
    router.push(getDashboardRoute(dash));
}

async function onPaletteCreate(payload: CreateSubmitPayload): Promise<void> {
    if (creating.value) return;
    const token = Symbol('create');
    creatingToken.value = token;
    try {
        const created = await performCreate(payload);
        // Either the user closed the palette (token nulled) or the store
        // returned null after toasting its own error — leave the form open
        // for retry.
        if (creatingToken.value !== token || !created) return;
        router.push(getDashboardRoute(created));
        closePalette();
    } catch (err) {
        toastRpcError(toast, err, 'Failed to create dashboard');
    } finally {
        if (creatingToken.value === token) creatingToken.value = null;
    }
}

type CreatedRouteable = {id: number | string; dashboardType?: string};

async function performCreate(
    payload: CreateSubmitPayload
): Promise<CreatedRouteable | null> {
    if (payload.type === 'classic') {
        const created = await dashboardsStore.create({
            name: payload.name,
            dashboardType: 'classic'
        });
        return created ? {id: created.id, dashboardType: 'classic'} : null;
    }
    const result = await analyticsStore.createDomainDashboard(
        payload.name,
        payload.type
    );
    // Optimistic insert; the store reconciles via Dashboard.Updated WS event.
    dashboardsStore.upsert({
        id: result.id,
        organizationId: result.organizationId,
        name: result.name,
        dashboardType: result.dashboardType,
        scope: result.scope ?? {},
        isDefault: result.isDefault ?? false,
        isPinned: result.isPinned ?? false,
        displayOrder: result.displayOrder ?? null,
        settings: result.settings ?? ({} as unknown as Dashboard['settings']),
        createdAt: result.createdAt ?? '',
        updatedAt: result.updatedAt ?? null,
        items: []
    });
    return {id: result.id, dashboardType: result.dashboardType};
}

async function onPaletteRename(
    id: number | string,
    nextName: string
): Promise<void> {
    const dashId = Number(id);
    if (!Number.isFinite(dashId)) return;
    const trimmed = nextName.trim();
    if (trimmed.length === 0) return;
    const current = dashboardsStore.dashboards[dashId]?.name ?? '';
    if (trimmed === current) return;
    try {
        await dashboardsStore.update(dashId, {name: trimmed});
    } catch (err) {
        toastRpcError(toast, err, 'Failed to rename dashboard');
    }
}

async function onPaletteDelete(id: number | string): Promise<void> {
    const dashId = Number(id);
    if (!Number.isFinite(dashId)) return;
    const nameBeforeRemove = dashboardsStore.dashboards[dashId]?.name;
    const ok = await dashboardsStore.remove(dashId);
    if (!ok) return;
    recents.forget(id);
    order.purge([id]);
    routeAfterDelete();
    if (nameBeforeRemove) toast.success(`Deleted ${nameBeforeRemove}`);
}

function routeAfterDelete(): void {
    const remaining = sortedDashboards.value;
    if (remaining.length > 0) {
        router.push({name: '/dash/[id]', params: {id: remaining[0].id}});
    } else {
        router.push({path: DASHBOARDS_PATH});
    }
}

function onPaletteMove(id: number | string, direction: -1 | 1): void {
    order.move(
        sortedDashboards.value.map((d) => d.id),
        id,
        direction
    );
}

// ⌘K / Ctrl+K opens the palette anywhere in the dashboards path. Editable
// targets are allowed — the palette has its own focus management.
useKeyboardShortcuts({
    bindings: [
        {
            key: 'k',
            ctrlOrMeta: true,
            allowInEditable: true,
            handler: () => openPalette()
        }
    ]
});

// Track recents on every dashboard route the user actually lands on.
watch(
    activeDashId,
    (id) => {
        if (typeof id === 'number' && Number.isFinite(id)) recents.touch(id);
    },
    {immediate: true}
);

onMounted(async () => {
    if (Object.keys(dashboardsStore.dashboards).length === 0) {
        await dashboardsStore.fetchAll();
    }

    // Auto-redirect /dash → default → first when no specific dashboard chosen.
    if (route.path === DASHBOARDS_PATH) {
        const defaultId = await dashboardsStore.getDefault();
        if (defaultId && dashboardsStore.dashboards[defaultId]) {
            router.replace({name: '/dash/[id]', params: {id: defaultId}});
            return;
        }
        const first = sortedDashboards.value[0];
        if (first) {
            router.replace({name: '/dash/[id]', params: {id: first.id}});
        }
    }
});
</script>
