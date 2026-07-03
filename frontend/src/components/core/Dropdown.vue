<template>
    <div :class="inlineLabel ? 'flex items-center gap-3' : ''">
        <label
            v-if="label"
            :for="id"
            class="dropdown-label"
            :class="inlineLabel ? 'dropdown-label--inline' : 'dropdown-label--stacked'"
        >
            {{ label }}
        </label>

        <div ref="dropdownAnchor" class="dropdown-anchor">
            <button
                :id="id"
                data-dropdown-toggle="dropdown"
                class="dropdown-trigger"
                type="button"
                role="combobox"
                :aria-expanded="expanded"
                :aria-controls="`${id}-listbox`"
                :aria-activedescendant="activeDescendantId"
                :disabled="disabled"
                :class="{'dropdown-trigger--active': expanded}"
                @click="toggleDropdown"
                @keydown="handleDropdownKeydown"
            >
                <span :key="selectedIcon" class="dropdown-selected">
                    <span v-if="selectedIcon" class="icon mr-1">
                        <i :class="['fad', selectedIcon]"></i>
                    </span>
                    <span>{{ selectedDisplay }}</span>
                </span>

                <span :key="String(expanded)" class="dropdown-chevron">
                    <i
                        class="fad"
                        :class="{
                            'fa-angle-down': !expanded,
                            'fa-angle-up': expanded
                        }"
                        aria-hidden="true"
                    ></i>
                </span>
            </button>

            <FloatingPanel
                ref="floatingPanelRef"
                :open="expanded"
                :anchor="dropdownAnchor"
                placement="bottom-start"
                :offset="4"
                :match-width="true"
                panel-class="floating-panel--glass overflow-hidden rounded-lg"
                @close="closeDropdown"
            >
                <div v-if="searchable" class="dropdown-search-wrap">
                    <input
                        ref="searchInputRef"
                        v-model="searchQuery"
                        type="text"
                        class="dropdown-search"
                        placeholder="Search..."
                        @keydown="handleDropdownKeydown"
                    />
                </div>

                <ul
                    :id="`${id}-listbox`"
                    role="listbox"
                    class="dropdown-list"
                    :aria-labelledby="id"
                    :style="{maxHeight: dropdownMaxHeight + 'px'}"
                    @keydown="handleDropdownKeydown"
                >
                    <template
                        v-for="(entry, index) in filteredEntries"
                        :key="getEntryKey(entry)"
                    >
                        <li
                            v-if="entry.startsGroup"
                            class="dropdown-group-label"
                            role="presentation"
                        >
                            {{ entry.groupLabel }}
                        </li>
                        <li
                            :id="`${id}-option-${entry.flatIndex}`"
                            role="option"
                            :aria-selected="selectedValue === entry.value"
                            class="dropdown-item"
                            :class="{'dropdown-item--focused': focusedIndex === index}"
                            @click="selectEntry(entry)"
                        >
                            <span v-if="entry.icon" class="icon mr-1">
                                <i :class="['fad', entry.icon]"></i>
                            </span>
                            <span>{{ entry.label }}</span>
                        </li>
                    </template>
                </ul>
            </FloatingPanel>
        </div>
    </div>
</template>

<script lang="ts" setup generic="T extends string | number | boolean">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    watch
} from 'vue';
import FloatingPanel from './FloatingPanel.vue';

interface RichOption<TValue> {
    value: TValue;
    label: string;
    icon?: string;
}

interface DropdownGroup<TValue> {
    label: string;
    items: RichOption<TValue>[];
}

interface DropdownEntry<TValue> {
    value: TValue;
    label: string;
    icon?: string;
    groupLabel?: string;
    startsGroup: boolean;
    flatIndex: number;
}

const id = useId();

const props = withDefaults(
    defineProps<{
        /** Flat options list. Use when there are no categories. */
        options?: T[];
        /** Optional parallel icons for the flat `options` list. */
        icons?: string[];
        /** Grouped options list. When set, takes precedence over `options`. */
        groups?: DropdownGroup<T>[];
        default?: T;
        label?: string;
        searchable?: boolean;
        toDefault?: boolean;
        disabled?: boolean;
        inlineLabel?: boolean;
        /**
         * Action-picker mode: show this text instead of auto-selecting the
         * first entry, and return to it when the picked entry leaves the list.
         */
        placeholder?: string;
    }>(),
    {
        disabled: false,
        inlineLabel: false
    }
);

const emit = defineEmits<{
    selected: [option: T, index: number];
    resetFilters: [];
}>();

// Normalise both props into a single ordered entries list. Each entry knows
// whether it starts a new group so the template can render a label row. The
// keyboard navigation, search and selection logic only ever sees the flat
// list — no special-casing for grouped vs ungrouped.
const allEntries = computed<DropdownEntry<T>[]>(() => {
    const entries: DropdownEntry<T>[] = [];
    if (props.groups && props.groups.length > 0) {
        let flatIndex = 0;
        for (const group of props.groups) {
            let firstInGroup = true;
            for (const item of group.items) {
                entries.push({
                    value: item.value,
                    label: item.label,
                    icon: item.icon,
                    groupLabel: group.label,
                    startsGroup: firstInGroup,
                    flatIndex
                });
                firstInGroup = false;
                flatIndex++;
            }
        }
        return entries;
    }
    return (props.options ?? []).map((option, flatIndex) => ({
        value: option,
        label: String(option),
        icon: props.icons?.[flatIndex],
        startsGroup: false,
        flatIndex
    }));
});

const selectedValue = ref<T | undefined>(
    props.placeholder !== undefined
        ? props.default
        : (props.default ?? allEntries.value[0]?.value)
);
const expanded = ref(false);
const focusedIndex = ref(-1);
const dropdownAnchor = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const floatingPanelRef = ref<{updatePosition: () => void} | null>(null);
const searchQuery = ref('');
const cachedViewportHeight = ref(window.innerHeight);

const dropdownMaxHeight = computed(() => cachedViewportHeight.value * 0.6);

const selectedEntry = computed(() =>
    allEntries.value.find((e) => e.value === selectedValue.value)
);
const selectedDisplay = computed(
    () =>
        selectedEntry.value?.label ??
        selectedValue.value?.toString() ??
        props.placeholder ??
        'Select'
);
const selectedIcon = computed(() => selectedEntry.value?.icon ?? '');

const filteredEntries = computed<DropdownEntry<T>[]>(() => {
    if (!searchQuery.value) return allEntries.value;
    const q = searchQuery.value.toLowerCase();
    // Filter by label, then re-mark startsGroup so group headers only render
    // for the first surviving item of each group.
    const filtered = allEntries.value.filter((e) =>
        e.label.toLowerCase().includes(q)
    );
    let lastGroup: string | undefined;
    return filtered.map((e) => {
        const startsGroup = e.groupLabel != null && e.groupLabel !== lastGroup;
        lastGroup = e.groupLabel;
        return {...e, startsGroup};
    });
});

const activeDescendantId = computed(() => {
    if (!expanded.value || focusedIndex.value < 0) return undefined;
    const activeEntry = filteredEntries.value[focusedIndex.value];
    return activeEntry ? `${id}-option-${activeEntry.flatIndex}` : undefined;
});

function onViewportResize() {
    cachedViewportHeight.value = window.innerHeight;
}

function getEntryKey(entry: DropdownEntry<T>) {
    return `${entry.flatIndex}-${String(entry.value)}`;
}

function closeDropdown() {
    expanded.value = false;
    focusedIndex.value = -1;
    searchQuery.value = '';
}

function openDropdown() {
    if (props.disabled || expanded.value) return;
    expanded.value = true;
    if (!filteredEntries.value.length) {
        focusedIndex.value = -1;
        return;
    }
    const idx = filteredEntries.value.findIndex(
        (e) => e.value === selectedValue.value
    );
    focusedIndex.value = idx >= 0 ? idx : 0;
}

function toggleDropdown() {
    if (props.disabled) return;
    if (expanded.value) {
        closeDropdown();
        return;
    }
    openDropdown();
}

function resetDropdown() {
    selectedValue.value =
        props.placeholder !== undefined
            ? props.default
            : (props.default ?? allEntries.value[0]?.value);
    closeDropdown();
}

function selectEntry(entry: DropdownEntry<T>) {
    selectedValue.value = entry.value;
    closeDropdown();
    emit('selected', entry.value, entry.flatIndex);
}

function handleDropdownKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (!expanded.value) {
            openDropdown();
            return;
        }
        if (!filteredEntries.value.length) {
            focusedIndex.value = -1;
            return;
        }
        if (event.key === 'ArrowDown') {
            focusedIndex.value = Math.min(
                focusedIndex.value + 1,
                filteredEntries.value.length - 1
            );
            return;
        }
        focusedIndex.value = Math.max(focusedIndex.value - 1, 0);
        return;
    }
    if (event.key === 'Enter' && expanded.value && focusedIndex.value >= 0) {
        event.preventDefault();
        const entry = filteredEntries.value[focusedIndex.value];
        if (entry) selectEntry(entry);
        return;
    }
    if (event.key === 'Escape' && expanded.value) {
        event.preventDefault();
        closeDropdown();
        return;
    }
    if (event.key === 'Tab' && expanded.value) {
        closeDropdown();
    }
}

watch(
    () => props.toDefault,
    (shouldReset) => {
        if (shouldReset) resetDropdown();
    }
);

watch(
    () => props.default,
    (newDefault) => {
        if (newDefault != null) {
            const found = allEntries.value.find((e) => e.value === newDefault);
            if (found) selectedValue.value = newDefault;
        }
    }
);

// When source data changes, keep selection valid: if current value is no
// longer in the list, fall back to the default, the first entry, or — in
// placeholder mode — back to the placeholder.
watch(allEntries, (entries) => {
    if (entries.length === 0) {
        selectedValue.value = undefined;
        return;
    }
    const stillExists = entries.some((e) => e.value === selectedValue.value);
    if (!stillExists) {
        const fallback = entries.find((e) => e.value === props.default);
        selectedValue.value =
            fallback?.value ??
            (props.placeholder !== undefined ? undefined : entries[0].value);
    }
});

watch(expanded, async (isExpanded) => {
    if (!isExpanded) return;
    await nextTick();
    floatingPanelRef.value?.updatePosition();
    if (props.searchable) searchInputRef.value?.focus();
});

watch(filteredEntries, async (entries) => {
    if (!entries.length) {
        focusedIndex.value = -1;
    } else if (focusedIndex.value >= entries.length) {
        focusedIndex.value = entries.length - 1;
    } else if (expanded.value && focusedIndex.value < 0) {
        focusedIndex.value = 0;
    }
    if (expanded.value) {
        await nextTick();
        floatingPanelRef.value?.updatePosition();
    }
});

onMounted(() => {
    window.addEventListener('resize', onViewportResize);
});

onBeforeUnmount(() => {
    window.removeEventListener('resize', onViewportResize);
});
</script>

<style scoped>
.dropdown-label {
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
}

.dropdown-label--stacked {
    display: block;
    padding: var(--input-padding) 0;
}

.dropdown-label--inline {
    display: inline;
    white-space: nowrap;
}

.dropdown-anchor {
    position: relative;
    display: inline-block;
    width: 100%;
}

.dropdown-trigger {
    position: relative;
    display: inline-flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border-radius: var(--input-radius);
    border: 1px solid var(--color-border-subtle);
    padding: var(--input-padding) var(--space-2) var(--input-padding)
        var(--space-3);
    font-size: var(--input-font-size);
    font-weight: var(--font-medium);
    text-align: left;
    transition:
        background-color var(--motion-hover),
        border-color var(--motion-hover),
        box-shadow var(--motion-hover);
    color: var(--color-text-primary);
    background: var(--glass-input);
    min-height: var(--touch-target-min);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 8%);
}

.dropdown-trigger:hover:not(:disabled) {
    background-color: var(--color-surface-2);
    border-color: var(--color-border-focus);
}

.dropdown-trigger:focus {
    outline: none;
    box-shadow: 0 0 0 var(--focus-ring-width) var(--color-border-focus);
}

.dropdown-trigger--active {
    border-color: var(--color-border-focus);
    box-shadow: 0 0 0 var(--focus-ring-width) color-mix(in srgb, var(--color-border-focus) 30%, transparent);
}

.dropdown-trigger:disabled {
    cursor: not-allowed;
    opacity: var(--opacity-disabled);
}

.dropdown-trigger:disabled:hover {
    background-color: var(--color-surface-1);
}

.dropdown-selected {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.dropdown-chevron {
    width: 28px;
    height: 28px;
    display: inline-grid;
    flex: 0 0 auto;
    place-items: center;
    border-left: 1px solid var(--color-border-subtle);
    color: var(--color-text-secondary);
}

.dropdown-search-wrap {
    padding: var(--input-padding) var(--space-2);
}

.dropdown-search {
    width: 100%;
    border-radius: var(--input-radius);
    padding: var(--input-padding);
    background-color: var(--glass-input);
    color: var(--color-text-secondary);
    border: 1px solid var(--glass-border);
}

.dropdown-list {
    color: var(--color-text-secondary);
    font-size: var(--input-font-size);
    overflow-y: auto;
}

.dropdown-group-label {
    padding: var(--space-1-5) var(--space-3) var(--space-1);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
    list-style: none;
}

.dropdown-item {
    display: flex;
    min-height: var(--touch-target-min);
    align-items: center;
    padding: var(--input-padding) var(--space-5);
    cursor: pointer;
}

.dropdown-item:hover,
.dropdown-item--focused {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}
</style>
