<template>
    <PageTemplate
        fill
        :tabs="tabs"
        v-model:search="query"
        title="Alerts"
        :searchable="true"
        search-placeholder="Search alerts…"
        :scope="scope"
        :filterable="true"
        :has-active-filter="activeFilterCount > 0"
        :filter-count="activeFilterCount"
        :loading="store.rulesLoading && filtered.length === 0"
        :empty="filtered.length === 0 && !store.rulesLoading"
        :empty-title="query ? 'No alerts match that search' : 'No alerts yet'"
        empty-sub="An alert watches for a condition on the devices you choose, and tells the people you choose when it happens."
        :skeleton-count="3"
        @filter-click="filterModalVisible = true"
    >
        <template #actions>
            <NewAlertMenu v-if="canWrite" @pick="onNewAlert" />
        </template>

        <template #empty-cta>
            <Button
                v-if="canWrite && !query"
                type="green"
                @click="quickVisible = true"
            >
                Create alert
            </Button>
        </template>

        <div class="ar-list">
            <AlertRuleCard
                v-for="r in filtered"
                :key="r.id"
                :rule="r"
                :kind-label="kindLabelFor(r.kind)"
                :firing-count="firingCountFor(r.id)"
                @open="openRulePreview(r)"
                @toggle="toggleRule(r)"
            />
        </div>

        <template #modals>
            <QuickAlertModal v-model="quickVisible" />
            <EditAlertRuleModal
                v-model="createVisible"
                mode="create"
            />
            <AlertRulePreviewModal
                :visible="previewVisible"
                :rule-id="previewRuleId"
                @close="previewVisible = false"
            />
            <FilterModal
                :visible="filterModalVisible"
                title="Filter alerts"
                match-label="alerts"
                :match-count="filtered.length"
                :sections="filterSections"
                :initial-state="activeFilterState"
                @close="filterModalVisible = false"
                @apply-generic="applyGenericFilters"
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import type {AlertRule, AlertRuleKind, AlertScopeType} from '@api/alert';
import {type ComputedRef, computed, inject, onMounted, ref} from 'vue';
import AlertRuleCard from '@/components/cards/AlertRuleCard.vue';
import Button from '@/components/core/Button.vue';
import FilterModal from '@/components/core/FilterModal.vue';
import NewAlertMenu, {
    type NewAlertPath
} from '@/components/core/NewAlertMenu.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import AlertRulePreviewModal from '@/components/modals/AlertRulePreviewModal.vue';
import EditAlertRuleModal from '@/components/modals/EditAlertRuleModal.vue';
import QuickAlertModal from '@/components/modals/QuickAlertModal.vue';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {usePermissions} from '@/composables/usePermissions';
import {
    booleanSection,
    countByKey,
    enumSection,
    severitySection
} from '@/helpers/filter-sections';
import {useAlertsStore} from '@/stores/alerts';
import type {RouteTab} from '@/types/page-template';

const tabs = inject<ComputedRef<RouteTab[]>>("alertTabs", computed(() => []));

const store = useAlertsStore();
const {canWrite} = usePermissions();

const query = ref('');
const createVisible = ref(false);
// Quick is the default way in — a built-in alert answers everything except
// which devices and who to tell. Custom stays one click away for the rest.
const quickVisible = ref(false);

function onNewAlert(path: NewAlertPath): void {
    if (path === 'quick') quickVisible.value = true;
    else createVisible.value = true;
}
const previewVisible = ref(false);
const previewRuleId = ref<number | null>(null);

const filterModalVisible = ref(false);
const kindFilter = ref<string[]>([]);
const severityFilter = ref<string[]>([]);
const enabledFilter = ref<string[]>([]);
const scopeTypeFilter = ref<string[]>([]);

onMounted(() => {
    store.fetchRules();
    store.fetchKinds();
    store.fetchInstances({state: 'active'});
});

function kindLabelFor(kind: AlertRuleKind): string {
    return store.kinds.find((k) => k.key === kind)?.label ?? kind;
}

// How many alerts each rule is firing right now — derived from the active
// instances already in the store, keyed by rule id.
const firingCounts = computed<Record<number, number>>(() => {
    const counts: Record<number, number> = {};
    for (const inst of Object.values(store.instances)) {
        if (inst.state !== 'active') continue;
        counts[inst.ruleId] = (counts[inst.ruleId] ?? 0) + 1;
    }
    return counts;
});

function firingCountFor(ruleId: number): number {
    return firingCounts.value[ruleId] ?? 0;
}

function toggleRule(rule: AlertRule): void {
    store.updateRule(rule.id, {enabled: !rule.enabled});
}

function primaryScopeType(rule: AlertRule): AlertScopeType | 'all' {
    const s = rule.scope;
    if (s.deviceIds?.length) return 'device';
    if (s.componentIds?.length) return 'component';
    if (s.groupIds?.length) return 'group';
    if (s.locationIds?.length) return 'location';
    if (s.tagIds?.length) return 'tag';
    return 'all';
}

const sortedRules = computed(() =>
    Object.values(store.rules).sort((a, b) => a.name.localeCompare(b.name))
);

const scopedRules = computed(() => {
    const kinds = new Set(kindFilter.value);
    const sevs = new Set(severityFilter.value);
    const scopes = new Set(scopeTypeFilter.value);
    const enabledMatch = enabledFilter.value[0];
    return sortedRules.value.filter((r) => {
        if (kinds.size && !kinds.has(r.kind)) return false;
        if (sevs.size && !sevs.has(r.severity)) return false;
        if (scopes.size && !scopes.has(primaryScopeType(r))) return false;
        if (enabledMatch === 'true' && !r.enabled) return false;
        if (enabledMatch === 'false' && r.enabled) return false;
        return true;
    });
});

const filtered = useFuzzySearch(scopedRules, query, {
    keys: ['name', 'kind']
});

const filterSections = computed(() => {
    const rules = sortedRules.value;
    const byKind = countByKey(rules, (r) => r.kind);
    const bySeverity = countByKey(rules, (r) => r.severity);
    const byScope = countByKey(rules, (r) => primaryScopeType(r));
    const enabledCount = rules.filter((r) => r.enabled).length;
    return [
        enumSection('kind', 'Kind', 'fa-sliders', byKind, (k) => kindLabelFor(k)),
        severitySection(bySeverity),
        booleanSection(
            'enabled',
            'State',
            'fa-toggle-on',
            'Enabled',
            'Disabled',
            enabledCount,
            rules.length - enabledCount
        ),
        enumSection('scopeType', 'Scope', 'fa-bullseye', byScope, (k) =>
            k === 'all' ? 'Organization-wide' : String(k).replace(/^./, (c) => c.toUpperCase())
        )
    ];
});

const activeFilterState = computed<Record<string, string[]>>(() => ({
    kind: kindFilter.value,
    severity: severityFilter.value,
    enabled: enabledFilter.value,
    scopeType: scopeTypeFilter.value
}));

const activeFilterCount = computed(
    () =>
        kindFilter.value.length +
        severityFilter.value.length +
        enabledFilter.value.length +
        scopeTypeFilter.value.length
);

function applyGenericFilters(next: Record<string, string[]>) {
    kindFilter.value = next.kind ?? [];
    severityFilter.value = next.severity ?? [];
    enabledFilter.value = next.enabled ?? [];
    scopeTypeFilter.value = next.scopeType ?? [];
    filterModalVisible.value = false;
}

const scope = {
    type: 'Rule',
    icon: 'fas fa-gavel',
    items: sortedRules,
    keys: ['name', 'kind'] as const,
    toHit: (r: AlertRule) => ({
        id: `rule-${r.id}`,
        label: r.name,
        meta: kindLabelFor(r.kind),
        type: 'Rule',
        icon: 'fas fa-gavel',
        route: `/alerts/rules/${r.id}`
    })
};

function openRulePreview(rule: AlertRule): void {
    previewRuleId.value = rule.id;
    previewVisible.value = true;
}
</script>

<style scoped>
.ar-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--grid-cell, 200px));
    grid-auto-rows: auto;
    justify-content: start;
    gap: var(--card-grid-gap, 12px);
}
</style>
