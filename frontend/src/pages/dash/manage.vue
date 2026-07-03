<template>
    <div class="dm">
        <header class="dm__hdr">
            <div class="dm__hdr-text">
                <h1 class="dm__title">Manage dashboards</h1>
                <p class="dm__subtitle">{{ rows.length }} {{ rows.length === 1 ? 'dashboard' : 'dashboards' }}</p>
            </div>
            <Button
                type="green"
                size="sm"
                title="New dashboard"
                aria-label="New dashboard"
                @click="openCreate"
            >
                <i class="fas fa-plus" />
            </Button>
        </header>

        <div class="dm__toolbar">
            <div class="dm__search">
                <i class="fas fa-magnifying-glass dm__search-icon" />
                <input
                    v-model="query"
                    type="text"
                    class="dm__search-input"
                    placeholder="Search dashboards"
                    spellcheck="false"
                />
                <button
                    v-if="query.length > 0"
                    class="dm__search-clear"
                    aria-label="Clear search"
                    @click="query = ''"
                >
                    <i class="fas fa-xmark" />
                </button>
            </div>

            <Transition name="dm-bulk">
                <div v-if="selectedIds.size > 0" class="dm__bulk" role="group" aria-label="Bulk actions">
                    <span class="dm__bulk-count">{{ selectedIds.size }} selected</span>
                    <span v-if="hiddenSelectedCount > 0" class="dm__bulk-hidden">
                        {{ hiddenSelectedCount }} hidden by search
                    </span>
                    <button class="btn-toolbar" @click="bulkMove(-1)">
                        <i class="fas fa-arrow-up" /> Move up
                    </button>
                    <button class="btn-toolbar" @click="bulkMove(1)">
                        <i class="fas fa-arrow-down" /> Move down
                    </button>
                    <button class="btn-toolbar btn-toolbar--danger" @click="confirmBulkDelete">
                        Delete
                    </button>
                    <button class="btn-toolbar btn-toolbar--ghost" @click="clearSelection">
                        Cancel
                    </button>
                </div>
            </Transition>
        </div>

        <div class="dm__table-wrap">
            <table class="dm__table">
                <thead>
                    <tr>
                        <th class="dm__col-check">
                            <input
                                type="checkbox"
                                :checked="allFilteredSelected"
                                :indeterminate.prop="someFilteredSelected"
                                aria-label="Select all"
                                @change="toggleSelectAll"
                            />
                        </th>
                        <th class="dm__col-name">Name</th>
                        <th class="dm__col-type">Type</th>
                        <th class="dm__col-widgets">Widgets</th>
                        <th class="dm__col-updated">Updated</th>
                        <th class="dm__col-actions" aria-label="Actions" />
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(row, idx) in filteredRows"
                        :key="row.id"
                        :class="{'dm__row--selected': selectedIds.has(String(row.id))}"
                    >
                        <td class="dm__col-check">
                            <input
                                type="checkbox"
                                :checked="selectedIds.has(String(row.id))"
                                :aria-label="`Select ${row.name}`"
                                @change="toggleRow(row.id)"
                            />
                        </td>
                        <td class="dm__col-name">
                            <DashboardTypeIcon :type="row.type" />
                            <RouterLink
                                class="dm__row-link"
                                :to="getDashboardRoute(row)"
                            >{{ row.name }}</RouterLink>
                            <span v-if="row.isDefault" class="dm__default-pill">Default</span>
                        </td>
                        <td class="dm__col-type">{{ typeLabel(row.type) }}</td>
                        <td class="dm__col-widgets">{{ row.widgetCount }}</td>
                        <td class="dm__col-updated">{{ formatUpdated(row.updatedAt) }}</td>
                        <td class="dm__col-actions">
                            <button
                                class="dm__icon-btn"
                                :disabled="idx === 0"
                                aria-label="Move up"
                                @click="moveOne(row.id, -1)"
                            >
                                <i class="fas fa-chevron-up" />
                            </button>
                            <button
                                class="dm__icon-btn"
                                :disabled="idx === filteredRows.length - 1"
                                aria-label="Move down"
                                @click="moveOne(row.id, 1)"
                            >
                                <i class="fas fa-chevron-down" />
                            </button>
                            <button
                                v-if="canDelete(row.id)"
                                class="dm__icon-btn dm__icon-btn--danger"
                                :disabled="isDefaultDashboard(row.id)"
                                title="Delete dashboard"
                                aria-label="Delete dashboard"
                                @click="deleteOne(row.id)"
                            >
                                <i class="fas fa-trash" />
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>

            <DashboardState
                v-if="dashboardsStore.loading && filteredRows.length === 0"
                state="loading"
                title="Loading dashboards"
            />
            <DashboardState
                v-else-if="filteredRows.length === 0"
                state="empty"
                icon="fas fa-table-cells-large"
                :title="query.length > 0 ? `No dashboards match \&quot;${query}\&quot;` : 'No dashboards yet'"
                :message="query.length === 0 ? 'Create your first dashboard to start visualising your fleet.' : undefined"
                :cta-label="query.length === 0 ? 'New dashboard' : undefined"
                @cta="openCreate"
            />
        </div>

        <ConfirmationModal ref="confirmRef" />
    </div>
</template>

<script setup lang="ts">
import {computed, inject, onMounted, ref} from 'vue';
import Button from '@/components/core/Button.vue';
import DashboardState from '@/components/dashboard/DashboardState.vue';
import DashboardTypeIcon from '@/components/dashboard/DashboardTypeIcon.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import {useDashboardOrder} from '@/composables/useDashboardOrder';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {orderForBulkMove} from '@/helpers/dashboardBulk';
import {OPEN_DASHBOARD_PALETTE_KEY} from '@/helpers/dashboardKeys';
import {isDefaultDashboard} from '@/helpers/dashboardOrder';
import {type PaletteRow, typeLabel} from '@/helpers/dashboardPalette';
import {
    deselectFiltered,
    projectSelection,
    selectFiltered
} from '@/helpers/dashboardSelection';
import {formatRelative} from '@/helpers/dashboardTime';
import {toastRpcError} from '@/helpers/domainErrors';
import {useAuthStore} from '@/stores/auth';
import {type Dashboard, useDashboardsStore} from '@/stores/dashboards';
import {useToastStore} from '@/stores/toast';
import {DOMAIN_TYPES} from '@/types/dashboard';

const dashboardsStore = useDashboardsStore();
const authStore = useAuthStore();
const toast = useToastStore();

const ROUTED_TYPES = new Set<string>(['analytics', ...DOMAIN_TYPES]);

const openPalette =
    inject(OPEN_DASHBOARD_PALETTE_KEY) ??
    (() => {
        // Manage page is always mounted under dash.vue; if the inject is
        // missing the route tree is broken — log instead of silently no-op.
        console.warn('[dashboards] OPEN_DASHBOARD_PALETTE_KEY not provided');
    });

function openCreate(): void {
    openPalette({mode: 'create'});
}

const query = ref('');
const selectedIds = ref<Set<string>>(new Set());
const order = useDashboardOrder();
const confirmRef = ref<InstanceType<typeof ConfirmationModal>>();

const allRows = computed<readonly OrderedRow[]>(() => {
    const all = Object.values(dashboardsStore.dashboards);
    const byId = new Map(all.map((d) => [String(d.id), d]));
    const seen = new Set<string>();
    const sorted: Dashboard[] = [];
    for (const id of order.ids.value) {
        const dash = byId.get(String(id));
        if (dash) {
            sorted.push(dash);
            seen.add(String(id));
        }
    }
    for (const dash of all) if (!seen.has(String(dash.id))) sorted.push(dash);
    return sorted.map(toRow);
});

const rows = computed(() => allRows.value);

const fuzzy = useFuzzySearch(() => allRows.value as OrderedRow[], query, {
    keys: ['name']
});

const filteredRows = computed(() => fuzzy.value);

const allFilteredSelected = computed(
    () =>
        filteredRows.value.length > 0 &&
        filteredRows.value.every((r) => selectedIds.value.has(String(r.id)))
);

const someFilteredSelected = computed(() => {
    const total = filteredRows.value.length;
    const selected = filteredRows.value.filter((r) =>
        selectedIds.value.has(String(r.id))
    ).length;
    return selected > 0 && selected < total;
});

interface OrderedRow extends PaletteRow {
    readonly updatedAt: string | null;
}

function toRow(dash: Dashboard): OrderedRow {
    return {
        id: dash.id,
        name: dash.name,
        type: (dash.dashboardType ?? 'classic') as PaletteRow['type'],
        widgetCount: dash.items?.length ?? 0,
        color: undefined,
        isPinned: Boolean(dash.isPinned),
        isDefault: isDefaultDashboard(dash.id) || Boolean(dash.isDefault),
        updatedAt: dash.updatedAt ?? null
    };
}

function getDashboardRoute(row: OrderedRow): string {
    if (ROUTED_TYPES.has(row.type)) return `/dash/${row.type}/${row.id}`;
    return `/dash/${row.id}`;
}

function formatUpdated(value: string | null): string {
    if (!value) return '—';
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return '—';
    return formatRelative(Date.now() - ts);
}

function toggleRow(id: number | string): void {
    const key = String(id);
    const next = new Set(selectedIds.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedIds.value = next;
}

function toggleSelectAll(): void {
    const filtered = filteredIds();
    selectedIds.value = allFilteredSelected.value
        ? deselectFiltered(selectedIds.value, filtered)
        : selectFiltered(selectedIds.value, filtered);
}

function clearSelection(): void {
    selectedIds.value = new Set();
}

function filteredIds(): readonly (number | string)[] {
    return filteredRows.value.map((row) => row.id);
}

function selectionView() {
    return projectSelection(selectedIds.value, filteredIds());
}

const hiddenSelectedCount = computed(() => selectionView().hidden.size);

function canDelete(id: number | string): boolean {
    const dashId = Number(id);
    return (
        Number.isFinite(dashId) &&
        authStore.canPerformComponent('dashboards', 'delete', dashId)
    );
}

function moveOne(id: number | string, direction: -1 | 1): void {
    order.move(visibleIds(), id, direction);
}

function bulkMove(direction: -1 | 1): void {
    if (selectedIds.value.size === 0) return;
    // Only move ids actually in the current filter — hidden selections are
    // left alone so the user never moves rows they can't see.
    const movable = [...selectionView().visible];
    const sorted = orderForBulkMove(visibleIds(), movable, direction);
    for (const id of sorted) order.move(visibleIds(), id, direction);
}

function visibleIds(): readonly (number | string)[] {
    return allRows.value.map((row) => row.id);
}

function deleteOne(id: number | string): void {
    if (!canDelete(id) || isDefaultDashboard(id)) return;
    const name =
        dashboardsStore.dashboards[Number(id)]?.name ?? 'this dashboard';
    confirmRef.value?.storeAction(() => executeDeleteOne(id), {
        title: `Delete ${name}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Delete'
    });
}

async function executeDeleteOne(id: number | string): Promise<void> {
    const ok = await dashboardsStore.remove(Number(id));
    if (!ok) return;
    const next = new Set(selectedIds.value);
    next.delete(String(id));
    selectedIds.value = next;
    order.purge([id]);
}

function confirmBulkDelete(): void {
    const ids = Array.from(selectedIds.value);
    if (ids.length === 0) return;
    const hidden = hiddenSelectedCount.value;
    const title = `Delete ${ids.length} dashboard${ids.length === 1 ? '' : 's'}?`;
    const message =
        hidden > 0
            ? `This cannot be undone. ${hidden} ${hidden === 1 ? 'row is' : 'rows are'} hidden by the current search.`
            : 'This cannot be undone.';
    confirmRef.value?.storeAction(() => executeBulkDelete(ids), {
        title,
        message,
        confirmLabel: 'Delete'
    });
}

async function executeBulkDelete(ids: string[]): Promise<void> {
    // One batch RPC instead of N sequential deletes. Filter to what the caller
    // may delete first; the backend also org-scopes and reports what it removed.
    const deletable = ids.filter(
        (id) => canDelete(id) && !isDefaultDashboard(id)
    );
    const removed = (
        await dashboardsStore.removeBulk(deletable.map(Number))
    ).map(String);
    if (removed.length > 0) {
        order.purge(removed);
        toast.success(
            `Deleted ${removed.length} dashboard${removed.length === 1 ? '' : 's'}`
        );
    }
    if (removed.length < ids.length) {
        toast.error(`${ids.length - removed.length} could not be deleted`);
    }
    clearSelection();
}

onMounted(async () => {
    if (Object.keys(dashboardsStore.dashboards).length === 0) {
        await dashboardsStore.fetchAll();
    }
});
</script>

<style scoped>
.dm {
    padding: var(--space-6) var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.dm__hdr {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
}

.dm__hdr-text {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}

.dm__title {
    margin: 0;
    font-size: var(--type-heading);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
}

.dm__subtitle {
    margin: 0;
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.dm__toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
}

.dm__search {
    position: relative;
    flex: 1;
    min-width: 280px;
    max-width: 480px;
}

.dm__search-icon {
    position: absolute;
    left: var(--space-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-tertiary);
    pointer-events: none;
}

.dm__search-input {
    width: 100%;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    padding: var(--space-2) var(--space-8) var(--space-2) calc(var(--space-3) + 20px);
    outline: none;
    transition: border-color var(--duration-fast) var(--ease-default);
}

.dm__search-input:focus {
    border-color: var(--color-primary);
}

.dm__search-clear {
    position: absolute;
    right: var(--space-2);
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-sm);
    cursor: pointer;
}

.dm__search-clear:hover {
    background: var(--glass-hover);
    color: var(--color-text-primary);
}

.dm__bulk {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-md);
}

.dm__bulk-count {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-primary-text);
    text-transform: uppercase;
    letter-spacing: 0.06em;
}

.dm__bulk-hidden {
    font-size: var(--type-caption);
    color: var(--color-warning);
    font-style: italic;
}

.dm__table-wrap {
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.dm__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--type-body);
}

.dm__table thead th {
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--color-border-default);
    padding: var(--space-3) var(--space-3);
    text-align: left;
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-tertiary);
}

.dm__table tbody tr {
    border-bottom: 1px solid var(--color-border-default);
    transition: background-color var(--duration-fast) var(--ease-default);
}

.dm__table tbody tr:last-child {
    border-bottom: none;
}

.dm__table tbody tr:hover {
    background-color: var(--glass-hover);
}

.dm__row--selected {
    background-color: color-mix(
        in srgb,
        var(--color-primary) 8%,
        transparent
    );
}

.dm__table td {
    padding: var(--space-3) var(--space-3);
    color: var(--color-text-secondary);
    vertical-align: middle;
}

.dm__col-check {
    width: 40px;
}

.dm__col-name {
    display: flex;
    align-items: center;
    gap: var(--space-2);
}

.dm__col-type,
.dm__col-widgets,
.dm__col-updated {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
}

.dm__col-actions {
    width: 140px;
    display: flex;
    gap: var(--space-1);
    justify-content: flex-end;
}

.dm__row-link {
    color: var(--color-text-primary);
    text-decoration: none;
    font-weight: var(--font-medium);
}

.dm__row-link:hover {
    color: var(--color-primary-text);
}

.dm__default-pill {
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    background: var(--color-surface-3);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-sm);
}

.dm__icon-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
    position: relative;
}

.dm__icon-btn::after {
    content: "";
    position: absolute;
    inset: -8px;
}

.dm__icon-btn:hover:not(:disabled) {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dm__icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

.dm__icon-btn--danger:hover:not(:disabled) {
    background-color: var(--color-danger-subtle);
    color: var(--color-danger-text);
}

.dm-bulk-enter-active,
.dm-bulk-leave-active {
    transition: all var(--duration-fast) var(--ease-default);
}

.dm-bulk-enter-from,
.dm-bulk-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>
