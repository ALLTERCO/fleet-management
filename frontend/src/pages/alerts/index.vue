<template>
    <PageTemplate
        fill
        :tabs="tabs"
        v-model:search="query"
        title="Alerts"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search alerts…"
        :scope="scope"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        :loading="store.instancesLoading && filteredInstances.length === 0"
        :empty="filteredInstances.length === 0 && !store.instancesLoading"
        :empty-title="emptyTitle"
        @filter-click="filterModalVisible = true"
    >
        <template #actions>
            <Button
                v-if="selectable"
                type="blue-hollow"
                size="sm"
                :disabled="filteredInstances.length === 0"
                @click="toggleSelectAll"
            >
                {{ allSelected ? 'Clear All' : 'Select All' }}
            </Button>
            <Button
                type="blue-hollow"
                size="sm"
                @click="toggleSelectMode"
            >
                {{ selectable ? 'Cancel' : 'Select' }}
            </Button>
        </template>

        <template #modals>
            <FilterModal
                :visible="filterModalVisible"
                title="Filter Alerts"
                match-label="alerts"
                :match-count="filteredInstances.length"
                :sections="filterSections"
                :initial-state="activeFilterState"
                @close="filterModalVisible = false"
                @apply-generic="applyGenericFilters"
            >
                <template #extra>
                    <DateRangeFilter v-model="dateRange" label="Triggered" />
                </template>
            </FilterModal>
            <SilenceModal v-model="silenceVisible" @silence="onBulkSilence" />
            <AlertInstanceModal
                v-model="detailVisible"
                :instance-id="detailInstanceId"
            />
        </template>

        <template #toggles>
            <ViewToggle
                :model-value="alertState"
                :options="[
                    {value: 'active', label: 'Active', icon: 'fas fa-bolt'},
                    {value: 'resolved', label: 'Resolved', icon: 'fas fa-check'}
                ]"
                @update:model-value="setAlertState"
            />
        </template>

        <template #empty-sub>
            When a rule triggers on an organization subject, its instance
            appears here. Use the <b>Rules</b> tab to define new rules.
        </template>

        <div
            v-if="selectable && filteredInstances.length > 0"
            class="aa-bulkbar"
        >
            <span class="aa-bulk-count">
                {{ selectedIds.size }} of {{ filteredInstances.length }} selected
            </span>
            <div class="aa-bulk-actions">
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="selectedIds.size === 0 || bulkRunning"
                    :loading="bulkRunning && bulkKind === 'ack'"
                    @click="runBulk('ack')"
                >
                    Mark read
                </Button>
                <Button
                    type="blue-hollow"
                    size="sm"
                    :disabled="selectedIds.size === 0 || bulkRunning"
                    @click="openSilenceModal"
                >
                    Silence
                </Button>
                <Button
                    type="green"
                    size="sm"
                    :disabled="selectedIds.size === 0 || bulkRunning"
                    :loading="bulkRunning && bulkKind === 'resolve'"
                    @click="runBulk('resolve')"
                >
                    Resolve
                </Button>
            </div>
        </div>

        <div class="aa-list">
            <AlertInstanceCard
                v-for="i in filteredInstances"
                :key="i.id"
                :instance="i"
                :selectable="selectable"
                :selected="selectedIds.has(i.id)"
                @open="openInstance(i.id)"
                @toggle-select="toggleSelect(i.id)"
            />
        </div>

    </PageTemplate>
</template>

<script setup lang="ts">
import {ALERT_SEVERITIES, type AlertInstance, type AlertSeverity, type AlertState} from '@api/alert';
import {type ComputedRef, computed, inject, onMounted, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import AlertInstanceCard from '@/components/cards/AlertInstanceCard.vue';
import Button from '@/components/core/Button.vue';
import DateRangeFilter from '@/components/core/DateRangeFilter.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ViewToggle from '@/components/core/ViewToggle.vue';
import AlertInstanceModal from '@/components/modals/AlertInstanceModal.vue';
import SilenceModal from '@/components/modals/SilenceModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {deviceTypeOf} from '@/helpers/deviceTypeFilter';
import {
    booleanSection,
    componentSection,
    countByKey,
    deviceClassSection,
    deviceSection,
    enumSection,
    groupSection,
    locationSection,
    severitySection,
    tagSection
} from '@/helpers/filter-sections';
import {useAlertsStore} from '@/stores/alerts';
import {useAuthStore} from '@/stores/auth';
import {useDevicesStore} from '@/stores/devices';
import {useEntityStore} from '@/stores/entities';
import {useGroupsStore} from '@/stores/groups';
import {useLocationsStore} from '@/stores/locations';
import {useTagsStore} from '@/stores/tags';
import {useToastStore} from '@/stores/toast';
import type {RouteTab, StatItem} from '@/types/page-template';

const store = useAlertsStore();
const authStore = useAuthStore();
const devicesStore = useDevicesStore();
const entityStore = useEntityStore();
const groupsStore = useGroupsStore();
const locationsStore = useLocationsStore();
const tagsStore = useTagsStore();
const toast = useToastStore();
const route = useRoute();
const router = useRouter();

const tabs = inject<ComputedRef<RouteTab[]>>('alertTabs', computed(() => []));

type ViewState = Extract<AlertState, 'active' | 'resolved'>;
const alertState = ref<ViewState>('active');

const query = ref('');
const severity = ref<AlertSeverity | ''>('');
const selectable = ref(false);
const selectedIds = ref<Set<number>>(new Set());
const detailVisible = ref(false);
const detailInstanceId = ref<number | null>(null);
const silenceVisible = ref(false);
const bulkRunning = ref(false);
const bulkKind = ref<'ack' | 'silence' | 'resolve' | null>(null);

const filterModalVisible = ref(false);
const mineFilter = ref<string[]>([]);
const silencedFilter = ref<string[]>([]);
const subjectTypeFilter = ref<string[]>([]);
const ruleIdFilter = ref<string[]>([]);
const deviceFilter = ref<string[]>([]);
const sourceFilter = ref<string[]>([]);
const componentFilter = ref<string[]>([]);
const groupFilter = ref<string[]>([]);
const locationFilter = ref<string[]>([]);
const dateRange = ref<{from: string; to: string}>({from: '', to: ''});
const tagFilter = ref<string[]>([]);

const filterSections = computed(() => {
    const instances = Object.values(store.instances).filter(
        (i) => i.state === alertState.value
    );
    const bySeverity = countByKey(instances, (i) => i.severity as string);
    const bySubjectType = countByKey(instances, (i) => i.source?.subjectType ?? 'unknown');
    const byRule = countByKey(
        instances.filter((i) => i.ruleId),
        (i) => Number(i.ruleId)
    );
    // Device alerts only — class comes from the alert's device.
    const byClass = countByKey(
        instances.filter((i) => i.source?.subjectType === 'device'),
        (i) =>
            deviceTypeOf(
                devicesStore.devices[String(i.source?.subjectId)]?.source
            )
    );
    const now = Date.now();
    const silenced = instances.filter(
        (i) => i.silencedUntil && new Date(i.silencedUntil).getTime() > now
    ).length;

    // "Mine" on an alert = acknowledged by the current user. Alerts have no
    // assignee model; the ack actor is the only per-user signal we own.
    const me = authStore.currentUserId;
    const mineCount = instances.filter(
        (i) => me != null && i.acknowledgedBy?.userId === me
    ).length;

    // Hybrid source: union of (a) full store contents and (b) IDs that already
    // appear on alert instances. The store gives users the complete pickable
    // set even when zero alerts have triggered yet; the instance side picks
    // up rare/legacy IDs the store may not still have.
    const subjectIdsByType = (type: string) =>
        new Set(
            instances
                .filter((i) => i.source?.subjectType === type)
                .map((i) => String(i.source?.subjectId))
        );

    const deviceIds = new Set<string>(Object.keys(devicesStore.devices));
    for (const id of subjectIdsByType('device')) deviceIds.add(id);
    const deviceItems = Array.from(deviceIds).map((sid) => ({
        id: sid,
        name: devicesStore.devices[sid]?.info?.name ?? sid
    }));

    const componentIds = new Set<string>(Object.keys(entityStore.entities));
    for (const id of subjectIdsByType('component')) componentIds.add(id);
    const componentItems = Array.from(componentIds).map((eid) => ({
        id: eid,
        name: entityStore.entities[eid]?.name ?? eid
    }));

    const groupIds = new Set<number>(
        Object.keys(groupsStore.groups).map(Number)
    );
    for (const id of subjectIdsByType('group')) groupIds.add(Number(id));
    const groupItems = Array.from(groupIds).map((gid) => ({
        id: gid,
        name: groupsStore.groups[gid]?.name ?? `Group #${gid}`
    }));

    const locationIds = new Set<number>(
        Object.keys(locationsStore.locations).map(Number)
    );
    for (const id of subjectIdsByType('location')) locationIds.add(Number(id));
    const locationItems = Array.from(locationIds).map((lid) => ({
        id: lid,
        name: locationsStore.locations[lid]?.name ?? `Location #${lid}`
    }));

    const tagIds = new Set<number>(Object.keys(tagsStore.tags).map(Number));
    for (const id of subjectIdsByType('tag')) tagIds.add(Number(id));
    const tagItems = Array.from(tagIds).map((tid) => ({
        id: tid,
        name: tagsStore.tags[tid]?.name ?? `Tag #${tid}`
    }));

    return [
        severitySection(bySeverity),
        enumSection(
            'mine',
            'Ownership',
            'fa-user-check',
            new Map<string, number>([['me', mineCount]]),
            () => 'Acknowledged by me'
        ),
        booleanSection(
            'silenced',
            'Silence',
            'fa-bell-slash',
            'Silenced',
            'Not silenced',
            silenced,
            instances.length - silenced
        ),
        enumSection('subjectType', 'Subject type', 'fa-bullseye', bySubjectType),
        deviceClassSection(byClass),
        deviceSection(deviceItems),
        componentSection(componentItems),
        groupSection(groupItems),
        locationSection(locationItems),
        tagSection(tagItems),
        enumSection('ruleId', 'Rule', 'fa-sliders', byRule, (k) => `Rule #${k}`)
    ];
});

const activeFilterState = computed<Record<string, string[]>>(() => ({
    severity: severity.value ? [severity.value] : [],
    mine: mineFilter.value,
    silenced: silencedFilter.value,
    subjectType: subjectTypeFilter.value,
    device: deviceFilter.value,
    source: sourceFilter.value,
    component: componentFilter.value,
    group: groupFilter.value,
    location: locationFilter.value,
    tag: tagFilter.value,
    ruleId: ruleIdFilter.value
}));

const activeFilterCount = computed(() => {
    const sectionCount = Object.values(activeFilterState.value).reduce(
        (sum, arr) => sum + arr.length,
        0
    );
    const dateCount = dateRange.value.from && dateRange.value.to ? 1 : 0;
    return sectionCount + dateCount;
});

function applyGenericFilters(next: Record<string, string[]>) {
    const picked = next.severity?.[0] ?? '';
    severity.value = (ALERT_SEVERITIES as readonly string[]).includes(picked)
        ? (picked as AlertSeverity)
        : '';
    mineFilter.value = next.mine ?? [];
    silencedFilter.value = next.silenced ?? [];
    subjectTypeFilter.value = next.subjectType ?? [];
    deviceFilter.value = next.device ?? [];
    sourceFilter.value = next.source ?? [];
    componentFilter.value = next.component ?? [];
    groupFilter.value = next.group ?? [];
    locationFilter.value = next.location ?? [];
    tagFilter.value = next.tag ?? [];
    ruleIdFilter.value = next.ruleId ?? [];
    filterModalVisible.value = false;
}

// All filters are client-side. The store keeps the full set for each state;
// selecting a state just ensures that slice is loaded.
function ensureStateLoaded(s: ViewState) {
    store.fetchInstances({state: s});
}

function setAlertState(s: ViewState) {
    alertState.value = s;
    selectedIds.value = new Set();
    ensureStateLoaded(s);
}

const emptyTitle = computed(() => {
    if (query.value || activeFilterCount.value > 0) return 'No alerts match';
    return alertState.value === 'active'
        ? 'No active alerts'
        : 'No resolved alerts yet';
});

const headerStats = computed<StatItem[]>(() => {
    const all = Object.values(store.instances);
    const active = all.filter((i) => i.state === 'active').length;
    const resolved = all.filter((i) => i.state === 'resolved').length;
    return [
        {value: active, label: 'active', status: 'warn'},
        {value: resolved, label: 'resolved', status: 'on'}
    ];
});

onMounted(() => {
    store.fetchInstances({state: 'active'});
    store.fetchInstances({state: 'resolved'});
    if (Object.keys(locationsStore.locations).length === 0) locationsStore.fetchLocations();
    if (Object.keys(tagsStore.tags).length === 0) tagsStore.fetchTags();
    syncModalFromQuery();
});

const sortedInstances = computed(() => {
    const now = Date.now();
    const subjectSet = new Set(subjectTypeFilter.value);
    const ruleSet = new Set(ruleIdFilter.value.map((s) => Number(s)));
    const deviceSet = new Set(deviceFilter.value);
    const sourceSet = new Set(sourceFilter.value);
    const componentSet = new Set(componentFilter.value);
    const groupSet = new Set(groupFilter.value);
    const locationSet = new Set(locationFilter.value);
    const tagSet = new Set(tagFilter.value);
    const silenceMode = silencedFilter.value[0] ?? '';
    const mineOnly = mineFilter.value.includes('me');
    const me = authStore.currentUserId;

    const matchesSubject = (
        set: Set<string>,
        i: AlertInstance,
        type: string
    ): boolean => {
        if (set.size === 0) return true;
        if (i.source?.subjectType !== type) return false;
        return set.has(String(i.source.subjectId));
    };

    const fromTs = dateRange.value.from
        ? new Date(dateRange.value.from).getTime()
        : null;
    const toTs = dateRange.value.to
        ? new Date(dateRange.value.to).getTime()
        : null;

    return Object.values(store.instances)
        .filter((i) => {
            if (i.state !== alertState.value) return false;
            if (severity.value && i.severity !== severity.value) return false;
            if (mineOnly && i.acknowledgedBy?.userId !== me) return false;
            if (fromTs !== null && toTs !== null) {
                const at =
                    alertState.value === 'resolved'
                        ? new Date(i.resolvedAt ?? i.lastTriggeredAt).getTime()
                        : new Date(i.lastTriggeredAt).getTime();
                if (at < fromTs || at > toTs) return false;
            }
            if (subjectSet.size > 0) {
                if (!subjectSet.has(i.source?.subjectType ?? 'unknown')) return false;
            }
            if (ruleSet.size > 0) {
                if (!ruleSet.has(i.ruleId ?? 0)) return false;
            }
            if (!matchesSubject(deviceSet, i, 'device')) return false;
            if (sourceSet.size > 0) {
                if (i.source?.subjectType !== 'device') return false;
                const cls = deviceTypeOf(
                    devicesStore.devices[String(i.source.subjectId)]?.source
                );
                if (!sourceSet.has(cls)) return false;
            }
            if (!matchesSubject(componentSet, i, 'component')) return false;
            if (!matchesSubject(groupSet, i, 'group')) return false;
            if (!matchesSubject(locationSet, i, 'location')) return false;
            if (!matchesSubject(tagSet, i, 'tag')) return false;
            // booleanSection emits 'true' / 'false' (see helpers/filter-sections.ts).
            if (silenceMode === 'true') {
                const t = i.silencedUntil ? new Date(i.silencedUntil).getTime() : 0;
                if (!(t > now)) return false;
            } else if (silenceMode === 'false') {
                const t = i.silencedUntil ? new Date(i.silencedUntil).getTime() : 0;
                if (t > now) return false;
            }
            return true;
        })
        .sort((a, b) => {
            if (alertState.value === 'resolved') {
                return (
                    new Date(b.resolvedAt ?? b.lastTriggeredAt).getTime() -
                    new Date(a.resolvedAt ?? a.lastTriggeredAt).getTime()
                );
            }
            return (
                new Date(b.lastTriggeredAt).getTime() -
                new Date(a.lastTriggeredAt).getTime()
            );
        });
});

const filteredInstances = useFuzzySearch(sortedInstances, query, {
    keys: ['title', 'message', 'source.subjectId']
});

const scope = {
    type: 'Alert',
    icon: 'fas fa-triangle-exclamation',
    items: sortedInstances,
    keys: ['title', 'message', 'source.subjectId'] as const,
    toHit: (a: AlertInstance) => ({
        id: `alert-${a.id}`,
        label: a.title,
        meta: a.severity,
        type: 'Alert',
        icon: 'fas fa-triangle-exclamation',
        route: `/alerts?instance=${a.id}`
    })
};

const allSelected = computed(
    () =>
        filteredInstances.value.length > 0 &&
        filteredInstances.value.every((i) => selectedIds.value.has(i.id))
);
const someSelected = computed(() => selectedIds.value.size > 0);

function toggleSelectMode() {
    selectable.value = !selectable.value;
    if (!selectable.value) selectedIds.value = new Set();
}

function toggleSelect(id: number) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds.value = next;
}

function toggleSelectAll() {
    if (allSelected.value) {
        selectedIds.value = new Set();
        return;
    }
    selectedIds.value = new Set(filteredInstances.value.map((i) => i.id));
}

function openInstance(id: number) {
    detailInstanceId.value = id;
    detailVisible.value = true;
    if (Number(route.query.instance) !== id) {
        void router.replace({query: {...route.query, instance: String(id)}});
    }
}

// The popup is URL-linkable via ?instance=<id> (search, rule preview, refresh).
function syncModalFromQuery() {
    const raw = route.query.instance;
    const id = Number(Array.isArray(raw) ? raw[0] : raw);
    if (Number.isFinite(id) && id > 0) {
        detailInstanceId.value = id;
        detailVisible.value = true;
    }
}

watch(() => route.query.instance, syncModalFromQuery);

// Closing the popup (X, backdrop, Esc, Close) drops the ?instance= param.
watch(detailVisible, (open) => {
    if (!open && route.query.instance != null) {
        const rest = {...route.query};
        delete rest.instance;
        void router.replace({query: rest});
    }
});

async function runBulk(kind: 'ack' | 'resolve') {
    const ids = Array.from(selectedIds.value);
    if (ids.length === 0) return;
    bulkRunning.value = true;
    bulkKind.value = kind;
    const action = kind === 'ack' ? store.ackInstance : store.resolveInstance;
    const results = await Promise.allSettled(ids.map((id) => action(id)));
    bulkRunning.value = false;
    bulkKind.value = null;
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = ids.length - ok;
    if (failed === 0) {
        toast.success(`${ok} alert${ok === 1 ? '' : 's'} ${kind}ed`);
    } else {
        toast.error(`${ok} succeeded, ${failed} failed`);
    }
    selectedIds.value = new Set();
}

function openSilenceModal() {
    if (selectedIds.value.size === 0) return;
    silenceVisible.value = true;
}

async function onBulkSilence(payload: {until: string; reason: string | null}) {
    const ids = Array.from(selectedIds.value);
    bulkRunning.value = true;
    bulkKind.value = 'silence';
    const results = await Promise.allSettled(
        ids.map((id) => store.silenceInstance(id, payload.until, payload.reason))
    );
    bulkRunning.value = false;
    bulkKind.value = null;
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const failed = ids.length - ok;
    if (failed === 0) {
        toast.success(`${ok} alert${ok === 1 ? '' : 's'} silenced`);
    } else {
        toast.error(`${ok} silenced, ${failed} failed`);
    }
    selectedIds.value = new Set();
}
</script>

<style scoped>
.aa-bulkbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-lg);
    flex-wrap: wrap;
}
.aa-bulk-count {
    font-size: var(--type-body);
    color: var(--color-text-secondary);
}
.aa-bulk-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
}
.aa-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--grid-cell, 200px));
    grid-auto-rows: auto;
    justify-content: start;
    gap: var(--card-grid-gap, 12px);
}
</style>
