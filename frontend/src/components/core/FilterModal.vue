<template>
    <Modal :visible="visible" @close="emit('close')">
        <template #title>{{ title }}</template>

        <div class="dfm">
            <!-- Slot for non-option filters that don't fit the section/option model
                 (date ranges, sliders, free-form fields). Renders above the option sections. -->
            <div v-if="$slots.extra" class="dfm__extra">
                <slot name="extra" />
            </div>

            <div class="dfm__filters">
                <section v-for="section in allSections" :key="section.key" class="dfm__section">
                    <header class="dfm__section-head">
                        <i class="fas dfm__section-icon" :class="section.icon" />
                        <span class="dfm__section-label">{{ section.label }}</span>
                    </header>

                    <!-- Long lists (searchable) → search input + scrollable list of checkbox rows. -->
                    <template v-if="section.searchable">
                        <input
                            v-model="sectionSearch[section.key]"
                            type="text"
                            class="dfm__section-search"
                            :placeholder="`Search ${section.label.toLowerCase()}…`"
                        />
                        <div class="dfm__section-list">
                            <button
                                v-for="opt in filteredOptions(section)"
                                :key="section.key + '-' + opt.key"
                                type="button"
                                class="dfm__row"
                                :class="{'dfm__row--active': isSelected(section.key, opt.key)}"
                                @click="toggleOption(section.key, opt.key)"
                            >
                                <span class="dfm__check" :class="{'dfm__check--radio': section.singleSelect}">
                                    <i v-if="isSelected(section.key, opt.key)" class="fas" :class="section.singleSelect ? 'fa-circle' : 'fa-check'" />
                                </span>
                                <span class="dfm__row-label">{{ opt.label }}</span>
                                <span v-if="opt.count != null" class="dfm__row-count">{{ opt.count }}</span>
                            </button>
                            <p v-if="filteredOptions(section).length === 0" class="dfm__empty">No matches</p>
                        </div>
                    </template>

                    <!-- Short lists → horizontal toggleable chip row (no toggle, no search). -->
                    <div v-else class="dfm__pills">
                        <button
                            v-for="opt in section.options"
                            :key="section.key + '-' + opt.key"
                            type="button"
                            class="dfm__pill"
                            :class="{'dfm__pill--active': isSelected(section.key, opt.key)}"
                            @click="toggleOption(section.key, opt.key)"
                        >
                            <i v-if="isSelected(section.key, opt.key)" class="fas fa-check dfm__pill-check" />
                            {{ opt.label }}
                            <span v-if="opt.count != null" class="dfm__pill-count">{{ opt.count }}</span>
                        </button>
                    </div>
                </section>
            </div>

            <div v-if="totalActiveCount > 0" class="dfm__active">
                <span class="dfm__active-label">{{ totalActiveCount }} active filter{{ totalActiveCount > 1 ? 's' : '' }}</span>
                <button type="button" class="dfm__clear" @click="clearAll">Clear all</button>
            </div>
        </div>

        <template #footer>
            <div class="dfm__footer">
                <span class="dfm__match-count">{{ matchCount }} {{ matchLabel }} match</span>
                <div class="dfm__footer-actions">
                    <Button type="blue-hollow" size="sm" @click="emit('close')">Cancel</Button>
                    <Button type="blue" size="sm" @click="applyFilters">Apply</Button>
                </div>
            </div>
        </template>
    </Modal>
</template>

<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import Button from '@/components/core/Button.vue';
import Modal from '@/components/modals/Modal.vue';
import type {
    DeviceFilterState,
    FilterGroupOption,
    FilterModelOption, 
    FilterOption,
    FilterSection,
    FilterState
} from '@/helpers/filter-modal-types';

// Re-export so existing `import FilterModal, { type FilterSection }` call-sites still compile
export type {
    DeviceFilterState,
    FilterGroupOption,
    FilterModelOption, 
    FilterOption,
    FilterSection,
    FilterState
};

// ── Props ──

const props = withDefaults(
    defineProps<{
        visible: boolean;
        matchCount: number;
        title?: string;
        matchLabel?: string;
        // Generic sections — use this for new pages
        sections?: FilterSection[];
        initialState?: FilterState;
        // Legacy props — backward compatible with firmware/backups
        groupOptions?: FilterGroupOption[];
        modelOptions?: FilterModelOption[];
        showFirmwareStatus?: boolean;
        initialFilters?: Partial<DeviceFilterState>;
    }>(),
    {
        title: 'Filters',
        matchLabel: 'items'
    }
);

const emit = defineEmits<{
    close: [];
    apply: [filters: DeviceFilterState];
    'apply-generic': [state: FilterState];
    'preview-state': [state: FilterState];
}>();

// ── State ──

// Per-section search input state — keys are section.key, values are the live query.
const sectionSearch = ref<Record<string, string>>({});
const selections = ref<Record<string, Set<string>>>({});

// ── Build unified sections from either generic or legacy props ──

const legacySections = computed<FilterSection[]>(() => {
    const result: FilterSection[] = [];
    if (props.groupOptions && props.groupOptions.length > 0) {
        result.push({
            key: 'groups',
            label: 'Groups',
            icon: 'fa-folder',
            searchable: true,
            options: props.groupOptions.map((g) => ({
                key: String(g.id),
                label: g.name,
                count: g.deviceCount
            }))
        });
    }
    if (props.modelOptions && props.modelOptions.length > 0) {
        result.push({
            key: 'models',
            label: 'Models',
            icon: 'fa-microchip',
            searchable: true,
            options: props.modelOptions.map((m) => ({
                key: m.model,
                label: m.label,
                count: m.count
            }))
        });
    }
    if (props.showFirmwareStatus) {
        result.push({
            key: 'statuses',
            label: 'Status',
            icon: 'fa-signal',
            searchable: false,
            options: [
                {key: 'update-available', label: 'Update available'},
                {key: 'up-to-date', label: 'Up to date'},
                {key: 'error', label: 'Check failed'}
            ]
        });
    }
    return result;
});

const allSections = computed(() => props.sections ?? legacySections.value);

// ── Selection state ──

function ensureSet(key: string): Set<string> {
    if (!selections.value[key]) selections.value[key] = new Set();
    return selections.value[key];
}

function isSelected(sectionKey: string, optKey: string): boolean {
    return ensureSet(sectionKey).has(optKey);
}

function emitPreviewState() {
    const state: FilterState = {};
    for (const [key, set] of Object.entries(selections.value)) {
        if (set.size > 0) state[key] = Array.from(set);
    }
    emit('preview-state', state);
}

function toggleOption(sectionKey: string, optKey: string) {
    const set = ensureSet(sectionKey);
    const section = allSections.value.find((s) => s.key === sectionKey);
    if (section?.singleSelect) {
        if (set.has(optKey)) set.clear();
        else {
            set.clear();
            set.add(optKey);
        }
    } else {
        if (set.has(optKey)) set.delete(optKey);
        else set.add(optKey);
    }
    emitPreviewState();
}

const totalActiveCount = computed(() =>
    Object.values(selections.value).reduce((sum, set) => sum + set.size, 0)
);

function clearAll() {
    for (const key in selections.value) selections.value[key].clear();
    sectionSearch.value = {};
    emitPreviewState();
}

// Active filter chips — derived from current selections so they update live.

// ── Search within section ──

function filteredOptions(section: FilterSection): FilterOption[] {
    const q = (sectionSearch.value[section.key] ?? '').toLowerCase().trim();
    if (!section.searchable || !q) return section.options;
    return section.options.filter(
        (o) =>
            o.label.toLowerCase().includes(q) || o.key.toLowerCase().includes(q)
    );
}

// ── Init from props ──

watch(
    () => props.visible,
    (vis) => {
        if (!vis) {
            sectionSearch.value = {};
            return;
        }
        // Reset selections
        selections.value = {};
        // Generic initial state
        if (props.initialState) {
            for (const [key, vals] of Object.entries(props.initialState)) {
                selections.value[key] = new Set(vals);
            }
        }
        // Legacy initial state
        if (props.initialFilters) {
            if (props.initialFilters.groupIds?.length)
                selections.value.groups = new Set(
                    props.initialFilters.groupIds.map(String)
                );
            if (props.initialFilters.models?.length)
                selections.value.models = new Set(props.initialFilters.models);
            if (props.initialFilters.statuses?.length)
                selections.value.statuses = new Set(
                    props.initialFilters.statuses
                );
        }
    }
);

// ── Apply ──

function applyFilters() {
    // Emit generic state
    const state: FilterState = {};
    for (const [key, set] of Object.entries(selections.value)) {
        state[key] = Array.from(set);
    }
    emit('apply-generic', state);

    // Also emit legacy format for backward compatibility
    emit('apply', {
        groupIds: Array.from(selections.value.groups ?? []).map(Number),
        models: Array.from(selections.value.models ?? []),
        statuses: Array.from(selections.value.statuses ?? []),
        search: ''
    });
    emit('close');
}
</script>

<style scoped>
.dfm {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.dfm__extra {
    padding-bottom: var(--space-3);
    margin-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border-medium);
}

.dfm__filters {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
}

.dfm__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.dfm__section-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
}
.dfm__section-icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
    width: var(--icon-size-sm);
    text-align: center;
}
.dfm__section-label {
    color: var(--color-text-primary);
    text-transform: none;
    letter-spacing: normal;
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    flex: 1;
}
.dfm__pills {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.dfm__pill {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-1-5) var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-family: inherit;
    cursor: pointer;
    transition:
        background var(--motion-hover),
        border-color var(--motion-hover),
        color var(--motion-hover);
}
.dfm__pill:hover {
    border-color: var(--color-border-strong);
    color: var(--color-text-primary);
}
.dfm__pill--active {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
    box-shadow:
        0 0 0 2px color-mix(in srgb, var(--color-primary) 25%, transparent),
        0 0 16px color-mix(in srgb, var(--color-primary) 45%, transparent);
}
.dfm__pill--active .dfm__pill-count {
    color: color-mix(in srgb, var(--color-text-primary) 80%, transparent);
}
.dfm__pill-check {
    color: var(--color-text-primary);
    font-size: var(--type-caption);
}
.dfm__pill-count {
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
}

.dfm__section-search {
    width: 100%;
    min-height: var(--btn-h-md);
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-3);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    font-family: inherit;
}
.dfm__section-search:focus {
    outline: none;
    border-color: var(--color-border-focus);
}
.dfm__section-list {
    max-height: 12.5rem;
    overflow-y: auto;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-sm);
}
.dfm__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--touch-target-min);
    padding: var(--space-1-5) var(--space-3);
    background: none;
    border: none;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--motion-hover);
}
.dfm__row:hover {
    background: color-mix(in srgb, var(--color-text-tertiary) 6%, transparent);
}
.dfm__row--active {
    color: var(--color-text-primary);
    background: color-mix(in srgb, var(--color-primary) 20%, transparent);
    box-shadow: inset 3px 0 0 var(--color-primary);
}
.dfm__row-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dfm__row-count {
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    font-family: var(--font-mono);
    flex-shrink: 0;
}

.dfm__check {
    width: var(--icon-size-sm);
    height: var(--icon-size-sm);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: var(--focus-ring-width) solid var(--color-border-medium);
    border-radius: var(--radius-sm);
    background: var(--color-surface-3);
    font-size: var(--type-caption);
    transition:
        background-color var(--motion-hover),
        border-color var(--motion-hover),
        color var(--motion-hover);
}
.dfm__row:hover .dfm__check {
    border-color: var(--color-text-tertiary);
}
.dfm__row--active .dfm__check {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}
.dfm__check--radio {
    border-radius: var(--radius-full);
}

.dfm__empty {
    padding: var(--space-3);
    font-size: var(--type-caption);
    color: var(--color-text-disabled);
    text-align: center;
}

.dfm__active {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border-medium);
}
.dfm__active-label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.dfm__clear {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--color-danger-text);
    font-size: var(--type-body);
    font-family: inherit;
    font-weight: var(--font-medium);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    transition: background-color var(--motion-hover);
}
.dfm__clear:hover {
    background: color-mix(in srgb, var(--color-danger) 10%, transparent);
}

.dfm__match-count {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-secondary);
}
.dfm__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}
.dfm__footer-actions {
    display: flex;
    gap: var(--space-2);
}
</style>
