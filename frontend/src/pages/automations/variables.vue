<template>
    <PageTemplate
        v-model:search="searchQuery"
        :selectable="canWrite"
        :items="filteredVarKeys"
        :item-key="varKey"
        :group-by="groupByCategory"
        pagination-mode="infinite"
        :page-size="500"
        title="Automations"
        :tabs="automationsTabs"
        :stats="headerStats"
        :searchable="true"
        search-placeholder="Search variables…"
        :filterable="true"
        :has-active-filter="hasActiveFilters"
        :filter-count="activeFilterCount"
        :loading="varLoading && varKeys.length === 0"
        :empty="!varLoading && filteredVarKeys.length === 0"
        :empty-title="emptyTitle"
        @filter-click="filterModalVisible = true"
    >
        <template #empty-sub>
            <template v-if="searchQuery || hasActiveFilters">
                Try adjusting your search or filters.
            </template>
            <template v-else>
                Variables let you reuse values across actions. Use
                <code class="vars-code" v-pre>${VAR_NAME}</code>
                in payloads.
            </template>
        </template>

        <template #actions>
            <Button
                v-if="canWrite"
                type="green"
                size="sm"
                title="New variable"
                aria-label="New variable"
                @click="openVarCreateModal"
            >
                <i class="fas fa-plus" />
            </Button>
        </template>

        <template v-if="canWrite" #empty-cta>
            <Button type="green" @click="openVarCreateModal">
                Create variable
            </Button>
        </template>

        <template #filter-chips>
            <span
                v-if="categoryFilter"
                class="vars-chip"
                @click="categoryFilter = ''"
            >
                <i class="fas fa-folder" />
                {{ categoryFilter }}
                <i class="fas fa-xmark vars-chip__x" />
            </span>
            <span
                v-if="usageFilter"
                class="vars-chip"
                @click="usageFilter = ''"
            >
                <i class="fas fa-play" />
                {{ usageFilter === 'used' ? 'Used' : 'Unused' }}
                <i class="fas fa-xmark vars-chip__x" />
            </span>
            <span
                v-if="valueFilter"
                class="vars-chip"
                @click="valueFilter = ''"
            >
                <i class="fas fa-equals" />
                {{ valueFilter === 'has-value' ? 'Has value' : 'Empty' }}
                <i class="fas fa-xmark vars-chip__x" />
            </span>
            <span
                v-if="statusFilter"
                class="vars-chip vars-chip--warn"
                @click="statusFilter = ''"
            >
                <i class="fas fa-exclamation-triangle" />
                {{
                    statusFilter === 'orphaned'
                        ? 'Undefined refs'
                        : 'Duplicates'
                }}
                <i class="fas fa-xmark vars-chip__x" />
            </span>
            <button
                v-if="hasActiveFilters"
                type="button"
                class="vars-chip vars-chip--clear"
                @click="clearAllFilters"
            >
                Clear all
            </button>
        </template>

        <template #filter-bar>
            <p v-if="varError" class="vars-error">{{ varError }}</p>
            <div
                v-if="orphanedVarNames.length && !statusFilter"
                class="vars-orphan"
            >
                <i class="fas fa-exclamation-triangle" />
                <span>
                    {{ orphanedVarNames.length }} undefined
                    variable{{ orphanedVarNames.length === 1 ? '' : 's' }}
                    referenced in actions
                </span>
                <Button
                    type="blue-hollow"
                    size="xs"
                    @click="statusFilter = 'orphaned'"
                >
                    Show
                </Button>
            </div>
        </template>

        <template #item="{item, selecting, selected, toggleSelect}">
            <CardValue_Variable
                :name="item"
                :value="statusFilter === 'orphaned' ? '' : getVarValue(item)"
                :usage-count="variableUsageCounts[item] ?? 0"
                :orphaned="statusFilter === 'orphaned'"
                :value-type="
                    statusFilter === 'orphaned'
                        ? null
                        : detectValueType(getVarValue(item))
                "
                :duplicate="duplicateValueGroups.has(item)"
                :selected="selected"
                @open="
                    selecting
                        ? toggleSelect()
                        : statusFilter === 'orphaned'
                          ? openVarCreateWithName(item)
                          : openVarDetail(item)
                "
            />
        </template>

        <template #bulk-actions="{selectedItems, clear}">
            <Button
                type="red"
                size="sm"
                title="Delete"
                aria-label="Delete selected"
                @click="bulkDeleteVars(selectedItems, clear)"
            >
                <i class="fas fa-trash" aria-hidden="true" />
            </Button>
        </template>

        <template #modals>
            <FilterModal
                :visible="filterModalVisible"
                :sections="varFilterSections"
                :initial-state="varFilterState"
                :match-count="filterMatchCount"
                title="Filter Variables"
                match-label="variables"
                @close="
                    filterModalVisible = false;
                    pendingFilterMatchCount = null;
                "
                @apply-generic="applyVarFilters"
                @preview-state="onFilterPreview"
            />

            <Modal
                :visible="varModalVisible"
                compact
                @close="varModalVisible = false"
            >
                <template #title>
                    {{ varEditingKey ? 'Edit Variable' : 'Add Variable' }}
                </template>
                <template #default>
                    <div class="vars-form">
                        <Input
                            v-model="varFormName"
                            label="Name"
                            placeholder="mqtt_server"
                            :error="varNameError"
                            :disabled="!!varEditingKey"
                            @blur="validateVarName"
                        />
                        <Input
                            v-model="varFormValue"
                            label="Value"
                            placeholder="mqtt.shelly.cloud"
                        />
                        <Input
                            v-model="varFormDesc"
                            label="Description (optional)"
                            placeholder="Production MQTT broker for fleet"
                        />
                        <div class="vars-form__row">
                            <span class="vars-form__label">Category</span>
                            <Dropdown
                                class="vars-form__dd"
                                :options="[
                                    ...varCategories,
                                    '+ New category'
                                ]"
                                :default="varFormCategory"
                                @selected="onCategorySelected"
                            />
                            <Input
                                v-if="varFormCategoryCustom"
                                v-model="varFormCategory"
                                placeholder="e.g. Monitoring, Integration"
                            />
                        </div>
                        <div
                            v-if="varFormName && !varNameError"
                            class="vars-preview"
                        >
                            <span class="vars-preview__label">
                                Use in payloads:
                            </span>
                            <code class="vars-preview__code">
                                {{ '$' + '{' + varFormName + '}' }}
                            </code>
                        </div>
                    </div>
                </template>
                <template #footer>
                    <div class="vars-footer">
                        <Button
                            type="blue-hollow"
                            @click="varModalVisible = false"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="green"
                            :loading="varSaving"
                            @click="saveVariable"
                        >
                            {{ varEditingKey ? 'Save' : 'Create' }}
                        </Button>
                    </div>
                </template>
            </Modal>

            <ConfirmationModal ref="varDeleteRef">
                <template #title>
                    <h3>Delete variable "{{ varDeletingKey }}"?</h3>
                </template>
            </ConfirmationModal>

            <VariableDetailModal
                :visible="varDetailVisible"
                :name="varDetailKey"
                :value="getVarValue(varDetailKey)"
                :description="getVarDesc(varDetailKey)"
                :category="getVarCategory(varDetailKey)"
                :usage-actions="varDetailUsageActions"
                @close="varDetailVisible = false"
                @edit="
                    varDetailVisible = false;
                    openVarEditModal(varDetailKey);
                "
                @delete="
                    varDetailVisible = false;
                    confirmVarDelete(varDetailKey);
                "
            />
        </template>
    </PageTemplate>
</template>

<script setup lang="ts">
import '@/styles/card-system.css';
import '@/styles/device-page.css';
import {
    type ComputedRef,
    computed,
    inject,
    onMounted,
    onUnmounted,
    ref
} from 'vue';
import CardValue_Variable from '@/components/cards/CardValue_Variable.vue';
import Button from '@/components/core/Button.vue';
import Dropdown from '@/components/core/Dropdown.vue';
import FilterModal, {
    type FilterSection,
    type FilterState
} from '@/components/core/FilterModal.vue';
import Input from '@/components/core/Input.vue';
import PageTemplate from '@/components/core/PageTemplate.vue';
import ConfirmationModal from '@/components/modals/ConfirmationModal.vue';
import Modal from '@/components/modals/Modal.vue';
import VariableDetailModal from '@/components/modals/VariableDetailModal.vue';
import {useMinDelay} from '@/composables/useMinDelay';
import {usePermissions} from '@/composables/usePermissions';
import useRegistry from '@/composables/useRegistry';
import {useVariables} from '@/composables/useVariables';
import {useToastStore} from '@/stores/toast';
import type {action_t} from '@/types';
import type {RouteTab, StatItem} from '@/types/page-template';

const automationsTabs = inject<RouteTab[] | ComputedRef<RouteTab[]>>(
    'automationsTabs',
    [] as RouteTab[]
);

const {canWrite} = usePermissions();
const toastStore = useToastStore();

const {
    error: varError,
    keys: varKeys,
    categories: varCategories,
    getValue: getVarValue,
    getDescription: getVarDesc,
    getCategory: getVarCategory,
    validateName: validateVarNameRule,
    nameExists: varNameExists,
    fetchAll: fetchVariables,
    saveVariable: saveVar,
    deleteVariable: deleteVar,
    renameVariable: renameVar,
    loading: rawVarLoadingRef
} = useVariables();
const varLoading = useMinDelay(rawVarLoadingRef, 500);

// Pull actions for usage / orphan / duplicate analysis. The variables page
// owns all variable concerns including cross-references into actions, so it
// loads the actions registry independently from the actions page.
const {data: actions} = useRegistry<action_t[]>('actions', 'rpc');
const actionItems = computed(() => actions.value || []);

const searchQuery = ref('');

const varKey = (k: string) => k;

const headerStats = computed<StatItem[]>(() => [
    {
        value: varKeys.value.length,
        label: varKeys.value.length === 1 ? 'variable' : 'variables'
    }
]);

// ── Filters ──
const categoryFilter = ref('');
const usageFilter = ref('');
const valueFilter = ref('');
const statusFilter = ref('');
const filterModalVisible = ref(false);
const varSort = ref<'az' | 'za' | 'most-used' | 'least-used'>('az');

// Group by category in the shared list — except in orphaned mode, where the
// undefined names have no category.
const groupByCategory = computed(() =>
    statusFilter.value === 'orphaned'
        ? undefined
        : (k: string) => getVarCategory(k)
);

const emptyTitle = computed(() =>
    searchQuery.value || hasActiveFilters.value
        ? 'No matches'
        : 'No variables yet'
);

const allFilters = computed(() => [
    categoryFilter.value,
    usageFilter.value,
    valueFilter.value,
    statusFilter.value
]);
const hasActiveFilters = computed(() => allFilters.value.some(Boolean));
const activeFilterCount = computed(
    () => allFilters.value.filter(Boolean).length
);

function clearAllFilters() {
    categoryFilter.value = '';
    usageFilter.value = '';
    valueFilter.value = '';
    statusFilter.value = '';
}

function countVarsMatching(predicate: (k: string) => boolean): number {
    return varKeys.value.filter(predicate).length;
}

const varFilterSections = computed<FilterSection[]>(() => {
    const usedCount = countVarsMatching(
        (k) => (variableUsageCounts.value[k] ?? 0) > 0
    );
    const unusedCount = varKeys.value.length - usedCount;
    const hasValueCount = countVarsMatching((k) => !!getVarValue(k));
    const emptyCount = varKeys.value.length - hasValueCount;
    const dupeCount = duplicateValueGroups.value.size;
    const orphanCount = orphanedVarNames.value.length;
    return [
        {
            key: 'category',
            label: 'Category',
            icon: 'fa-folder',
            singleSelect: true,
            searchable: true,
            options: varCategories.value.map((c) => ({
                key: c,
                label: c,
                count: countVarsMatching((k) => getVarCategory(k) === c)
            }))
        },
        {
            key: 'usage',
            label: 'Usage',
            icon: 'fa-play',
            singleSelect: true,
            options: [
                {key: 'used', label: 'Used in actions', count: usedCount},
                {key: 'unused', label: 'Unused', count: unusedCount}
            ]
        },
        {
            key: 'value',
            label: 'Value',
            icon: 'fa-equals',
            singleSelect: true,
            options: [
                {key: 'has-value', label: 'Has value', count: hasValueCount},
                {key: 'empty', label: 'Empty', count: emptyCount}
            ]
        },
        {
            key: 'status',
            label: 'Status',
            icon: 'fa-exclamation-triangle',
            singleSelect: true,
            options: [
                {
                    key: 'orphaned',
                    label: 'Undefined references',
                    count: orphanCount
                },
                {
                    key: 'duplicate',
                    label: 'Duplicate values',
                    count: dupeCount
                }
            ]
        },
        {
            key: 'sort',
            label: 'Sort by',
            icon: 'fa-arrow-down-a-z',
            singleSelect: true,
            options: [
                {key: 'az', label: 'A → Z'},
                {key: 'za', label: 'Z → A'},
                {key: 'most-used', label: 'Most used'},
                {key: 'least-used', label: 'Least used'}
            ]
        }
    ];
});

const varFilterState = computed<FilterState>(() => {
    const state: FilterState = {};
    if (categoryFilter.value) state.category = [categoryFilter.value];
    if (usageFilter.value) state.usage = [usageFilter.value];
    if (valueFilter.value) state.value = [valueFilter.value];
    if (statusFilter.value) state.status = [statusFilter.value];
    state.sort = [varSort.value];
    return state;
});

function applyVarFilters(state: FilterState) {
    categoryFilter.value = state.category?.[0] ?? '';
    usageFilter.value = state.usage?.[0] ?? '';
    valueFilter.value = state.value?.[0] ?? '';
    statusFilter.value = state.status?.[0] ?? '';
    const nextSort = state.sort?.[0];
    if (nextSort && SORT_CYCLE.includes(nextSort as VarSort)) {
        varSort.value = nextSort as VarSort;
    }
}

const pendingFilterMatchCount = ref<number | null>(null);
const filterMatchCount = computed(
    () => pendingFilterMatchCount.value ?? filteredVarKeys.value.length
);

function onFilterPreview(state: FilterState) {
    const cat = state.category?.[0] ?? '';
    const usage = state.usage?.[0] ?? '';
    const val = state.value?.[0] ?? '';
    const status = state.status?.[0] ?? '';
    if (status === 'orphaned') {
        pendingFilterMatchCount.value = orphanedVarNames.value.length;
        return;
    }
    let result = varKeys.value;
    if (cat) result = result.filter((k) => getVarCategory(k) === cat);
    if (usage === 'used')
        result = result.filter((k) => (variableUsageCounts.value[k] ?? 0) > 0);
    else if (usage === 'unused')
        result = result.filter((k) => !variableUsageCounts.value[k]);
    if (val === 'has-value')
        result = result.filter((k) => !!getVarValue(k));
    else if (val === 'empty') result = result.filter((k) => !getVarValue(k));
    if (status === 'duplicate')
        result = result.filter((k) => duplicateValueGroups.value.has(k));
    if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        result = result.filter(
            (k) =>
                k.toLowerCase().includes(q) ||
                getVarValue(k).toLowerCase().includes(q) ||
                getVarDesc(k).toLowerCase().includes(q)
        );
    }
    pendingFilterMatchCount.value = result.length;
}

// Sort selection lives inside the filter modal; the canonical key set
// stays as a single source for both render and applyVarFilters validation.
type VarSort = 'az' | 'za' | 'most-used' | 'least-used';
const SORT_CYCLE: VarSort[] = ['az', 'za', 'most-used', 'least-used'];

function sortVarKeys(keys: string[]): string[] {
    const sorted = [...keys];
    switch (varSort.value) {
        case 'za':
            return sorted.sort((a, b) => b.localeCompare(a));
        case 'most-used':
            return sorted.sort(
                (a, b) =>
                    (variableUsageCounts.value[b] ?? 0) -
                    (variableUsageCounts.value[a] ?? 0)
            );
        case 'least-used':
            return sorted.sort(
                (a, b) =>
                    (variableUsageCounts.value[a] ?? 0) -
                    (variableUsageCounts.value[b] ?? 0)
            );
        default:
            return sorted.sort((a, b) => a.localeCompare(b));
    }
}

// ── Reference scan: usage counts, orphan, duplicates ──
const varRefScan = computed(() => {
    const counts: Record<string, number> = {};
    const names = new Set<string>();
    const regex = /\$\{([A-Za-z0-9_]+)\}/g;
    for (const action of actionItems.value) {
        const text = JSON.stringify(action.actions ?? []);
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            counts[match[1]] = (counts[match[1]] ?? 0) + 1;
            names.add(match[1]);
        }
    }
    return {counts, names};
});
const variableUsageCounts = computed(() => varRefScan.value.counts);
const allReferencedVarNames = computed(() => varRefScan.value.names);

const orphanedVarNames = computed(() =>
    [...allReferencedVarNames.value].filter(
        (name) => !varKeys.value.includes(name)
    )
);

const duplicateValueGroups = computed(() => {
    const byValue: Record<string, string[]> = {};
    for (const key of varKeys.value) {
        const v = getVarValue(key);
        if (!v) continue;
        if (!byValue[v]) byValue[v] = [];
        byValue[v].push(key);
    }
    const dupes = new Set<string>();
    for (const keys of Object.values(byValue)) {
        if (keys.length > 1) for (const k of keys) dupes.add(k);
    }
    return dupes;
});

function detectValueType(
    value: string
): {type: string; icon: string} | null {
    if (!value) return null;
    if (/^https?:\/\//.test(value)) return {type: 'URL', icon: 'fa-link'};
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/.test(value))
        return {type: 'IP', icon: 'fa-network-wired'};
    if (/^\/[\w/.-]+$/.test(value))
        return {type: 'Path', icon: 'fa-folder-open'};
    if (/^\d+(\.\d+)?$/.test(value))
        return {type: 'Number', icon: 'fa-hashtag'};
    if (/^(true|false)$/i.test(value))
        return {type: 'Boolean', icon: 'fa-toggle-on'};
    if (/^[a-zA-Z0-9+/=]{20,}$/.test(value))
        return {type: 'Token', icon: 'fa-key'};
    return null;
}

// ── Bulk delete via the shared select-and-delete bar ──
function bulkDeleteVars(keys: string[], clear: () => void) {
    if (!keys.length) return;
    varDeletingKey.value = `${keys.length} selected variable${keys.length === 1 ? '' : 's'}`;
    varDeleteRef.value?.storeAction(async () => {
        try {
            for (const key of keys) await deleteVar(key);
            toastStore.success(
                `Deleted ${keys.length} variable${keys.length === 1 ? '' : 's'}`
            );
            clear();
            await fetchVariables();
        } catch {
            toastStore.error('Failed to delete variables');
        }
    });
}



// ── Filter pipeline ──
const filteredVarKeys = computed(() => {
    if (statusFilter.value === 'orphaned') return orphanedVarNames.value;
    let result = varKeys.value;
    if (categoryFilter.value)
        result = result.filter(
            (k) => getVarCategory(k) === categoryFilter.value
        );
    if (usageFilter.value === 'used')
        result = result.filter((k) => (variableUsageCounts.value[k] ?? 0) > 0);
    else if (usageFilter.value === 'unused')
        result = result.filter((k) => !variableUsageCounts.value[k]);
    if (valueFilter.value === 'has-value')
        result = result.filter((k) => !!getVarValue(k));
    else if (valueFilter.value === 'empty')
        result = result.filter((k) => !getVarValue(k));
    if (statusFilter.value === 'duplicate')
        result = result.filter((k) => duplicateValueGroups.value.has(k));
    if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        result = result.filter(
            (k) =>
                k.toLowerCase().includes(q) ||
                getVarValue(k).toLowerCase().includes(q) ||
                getVarDesc(k).toLowerCase().includes(q)
        );
    }
    return sortVarKeys(result);
});

// ── Variable modal state ──
const varModalVisible = ref(false);
const varEditingKey = ref<string | null>(null);
const varFormName = ref('');
const varFormValue = ref('');
const varFormDesc = ref('');
const varFormCategory = ref('');
const varFormCategoryCustom = ref(false);
const varNameError = ref('');
const varSaving = ref(false);
const varDeletingKey = ref('');
const varDeleteRef = ref<InstanceType<typeof ConfirmationModal>>();

function validateVarName() {
    const err = validateVarNameRule(varFormName.value);
    if (err) {
        varNameError.value = err;
        return;
    }
    if (!varEditingKey.value && varNameExists(varFormName.value.trim())) {
        varNameError.value = 'Already exists';
        return;
    }
    varNameError.value = '';
}

function onCategorySelected(val: string | number | boolean) {
    const s = String(val);
    if (s === '+ New category') {
        varFormCategoryCustom.value = true;
        varFormCategory.value = '';
        return;
    }
    varFormCategoryCustom.value = false;
    varFormCategory.value = s;
}

function openVarCreateModal() {
    varEditingKey.value = null;
    varFormName.value = '';
    varFormValue.value = '';
    varFormDesc.value = '';
    varFormCategory.value = '';
    varFormCategoryCustom.value = false;
    varNameError.value = '';
    varModalVisible.value = true;
}

function openVarCreateWithName(name: string) {
    openVarCreateModal();
    varFormName.value = name;
}

function openVarEditModal(key: string) {
    varEditingKey.value = key;
    varFormName.value = key;
    varFormValue.value = getVarValue(key);
    varFormDesc.value = getVarDesc(key);
    const cat = getVarCategory(key);
    varFormCategory.value = cat === 'Other' ? '' : cat;
    varFormCategoryCustom.value = false;
    varNameError.value = '';
    varModalVisible.value = true;
}

async function saveVariable() {
    validateVarName();
    if (varNameError.value) return;
    varSaving.value = true;
    try {
        const name = varFormName.value.trim();
        const metadata = {
            description: varFormDesc.value.trim() || undefined,
            category: varFormCategory.value.trim() || undefined
        };
        if (varEditingKey.value)
            await renameVar({
                oldName: varEditingKey.value,
                newName: name,
                value: varFormValue.value,
                metadata
            });
        else await saveVar({name, value: varFormValue.value, metadata});
        toastStore.success(
            varEditingKey.value ? 'Variable saved' : 'Variable created'
        );
        varModalVisible.value = false;
        await fetchVariables();
    } catch {
        toastStore.error('Failed to save variable');
    } finally {
        varSaving.value = false;
    }
}

// Cmd/Ctrl+Enter saves the modal
function onVarKeydown(e: KeyboardEvent) {
    if (
        (e.ctrlKey || e.metaKey) &&
        e.key === 'Enter' &&
        varModalVisible.value
    ) {
        e.preventDefault();
        saveVariable();
    }
}
onMounted(() => window.addEventListener('keydown', onVarKeydown));
onUnmounted(() => window.removeEventListener('keydown', onVarKeydown));

function confirmVarDelete(key: string) {
    varDeletingKey.value = key;
    varDeleteRef.value?.storeAction(async () => {
        try {
            await deleteVar(key);
            toastStore.success(`Deleted "${key}"`);
            await fetchVariables();
        } catch {
            toastStore.error('Failed to delete');
        }
    });
}

// ── Variable detail modal ──
const varDetailVisible = ref(false);
const varDetailKey = ref('');

const varDetailUsageActions = computed(() => {
    if (!varDetailKey.value) return [];
    const pattern = `\${${varDetailKey.value}}`;
    return actionItems.value
        .filter((a: action_t) =>
            JSON.stringify(a.actions ?? []).includes(pattern)
        )
        .map((a: action_t) => ({id: a.id, name: a.name}));
});

function openVarDetail(key: string) {
    varDetailKey.value = key;
    varDetailVisible.value = true;
}
</script>

<style scoped>
.vars-code {
    font-family: var(--font-mono);
    color: var(--color-primary);
}

.vars-error {
    margin: 0;
    padding: var(--space-3);
    background: var(--color-danger-subtle);
    color: var(--color-danger-text);
    border-radius: var(--radius-md);
    font-size: var(--type-body);
}

/* Filter chips */
.vars-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    flex-shrink: 0;
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
}
.vars-chip:hover {
    border-color: var(--color-text-tertiary);
}
.vars-chip__x {
    color: var(--color-text-disabled);
}
.vars-chip--clear {
    background: color-mix(in srgb, var(--color-danger-text) 8%, transparent);
    border-color: transparent;
    color: var(--color-danger-text);
}
.vars-chip--clear:hover {
    background: color-mix(in srgb, var(--color-danger-text) 15%, transparent);
}
.vars-chip--warn {
    background: color-mix(in srgb, var(--color-warning-text) 8%, transparent);
    border-color: color-mix(
        in srgb,
        var(--color-warning-text) 25%,
        transparent
    );
    color: var(--color-warning-text);
}
.vars-chip--sort {
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-default);
    color: var(--color-text-secondary);
    margin-left: auto;
}
.vars-chip--sort:hover {
    border-color: var(--color-text-tertiary);
    background: var(--color-surface-4);
}

/* Orphan banner */
.vars-orphan {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    margin-bottom: var(--space-2);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-warning-text) 6%, transparent);
    border: 1px solid
        color-mix(in srgb, var(--color-warning-text) 20%, transparent);
    color: var(--color-warning-text);
    font-size: var(--type-body);
    font-weight: 600;
}
.vars-orphan i {
    flex-shrink: 0;
}
.vars-orphan span {
    flex: 1;
}

/* Modal form */
.vars-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.vars-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
}
.vars-form__row {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.vars-form__label {
    font-size: var(--type-body);
    font-weight: 700;
    color: var(--color-text-secondary);
}
.vars-form__dd {
    flex: 1;
}
.vars-preview {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: rgba(var(--ar-action), 0.06);
    border: 1px solid rgba(var(--ar-action), 0.18);
}
.vars-preview__label {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.vars-preview__code {
    font-family: var(--font-mono);
    font-weight: 700;
    color: var(--a-action);
}
</style>
