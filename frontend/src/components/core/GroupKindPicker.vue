<template>
    <div ref="rootRef" class="gkp">
        <!-- Trigger row: current selection + change button -->
        <button
            type="button"
            class="gkp__trigger"
            :class="{'gkp__trigger--open': open}"
            :aria-expanded="open"
            @click="toggle"
        >
            <span class="gkp__trigger-label">
                {{ selectedLabel || 'Pick a kind' }}
            </span>
            <span class="gkp__trigger-category">
                {{ selectedCategory }}
            </span>
            <i
                class="fa-solid fa-chevron-down gkp__trigger-chevron"
                :class="{'gkp__trigger-chevron--open': open}"
                aria-hidden="true"
            />
        </button>

        <!-- Popover: search + sectioned list -->
        <div v-if="open" class="gkp__panel" role="listbox">
            <Spinner v-if="loading && kinds.length === 0" size="sm" class="gkp__spinner" />
            <div v-else-if="loadError && kinds.length === 0" class="gkp__error">
                <i class="fa-solid fa-circle-exclamation gkp__error-icon" aria-hidden="true" />
                <div class="gkp__error-body">
                    <p class="gkp__error-msg">Couldn't load group kinds.</p>
                    <p class="gkp__error-detail">{{ loadError }}</p>
                </div>
                <button type="button" class="gkp__error-retry" @click="onRetry">
                    Retry
                </button>
            </div>
            <template v-else>
                <label class="gkp__search">
                    <i class="fa-solid fa-magnifying-glass" aria-hidden="true" />
                    <input
                        ref="searchInput"
                        v-model.trim="query"
                        type="search"
                        class="gkp__search-input"
                        placeholder="Search kinds…"
                        autocomplete="off"
                        @keydown.escape="close"
                    />
                    <button
                        v-if="query"
                        type="button"
                        class="gkp__search-clear"
                        title="Clear search"
                        @click="query = ''"
                    >
                        <i class="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                </label>

                <div class="gkp__list">
                    <template v-if="visibleSections.length > 0">
                        <section
                            v-for="section in visibleSections"
                            :key="section.category"
                            class="gkp__section"
                        >
                            <h3 class="gkp__section-title">
                                {{ categoryLabel(section.category) }}
                                <span class="gkp__section-count">{{ section.kinds.length }}</span>
                            </h3>
                            <button
                                v-for="kind in section.kinds"
                                :key="kind.id"
                                type="button"
                                class="gkp__option"
                                :class="{'gkp__option--selected': kind.id === modelValue}"
                                role="option"
                                :aria-selected="kind.id === modelValue"
                                @click="pick(kind.id)"
                            >
                                <span class="gkp__option-label">{{ kind.displayName }}</span>
                                <span v-if="kind.description" class="gkp__option-desc">{{ kind.description }}</span>
                            </button>
                        </section>
                    </template>
                    <p v-else class="gkp__empty">
                        No kinds match "{{ query }}".
                    </p>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, ref} from 'vue';
import Spinner from '@/components/core/Spinner.vue';
import {type GroupKind, useGroupKinds} from '@/composables/useGroupKinds';

// ── Props / model ──

const modelValue = defineModel<string>({default: 'manual'});

const {kinds, byId, byCategory, loading, loadError, ensureLoaded, retry, search} =
    useGroupKinds();

// Trigger fetch as soon as the picker mounts so the open click is instant.
void ensureLoaded();

// ── Open state ──

const open = ref(false);
const query = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

function toggle(): void {
    open.value = !open.value;
    if (open.value) {
        void ensureLoaded();
        nextTick(() => searchInput.value?.focus());
    } else {
        query.value = '';
    }
}

function close(): void {
    open.value = false;
    query.value = '';
}

function pick(id: string): void {
    modelValue.value = id;
    close();
}

function onRetry(): void {
    void retry();
}

// Close when the user clicks outside THIS picker. Use the template ref
// instead of document.querySelector — that returned the FIRST .gkp on
// the page, which broke multi-picker scenarios.
const rootRef = ref<HTMLElement | null>(null);
function handleDocClick(ev: MouseEvent): void {
    if (!open.value) return;
    const target = ev.target as Node | null;
    const root = rootRef.value;
    if (root && target && !root.contains(target)) close();
}
document.addEventListener('click', handleDocClick, true);
onBeforeUnmount(() => {
    document.removeEventListener('click', handleDocClick, true);
});

// ── Selected display ──

const selected = computed<GroupKind | null>(
    () => byId.value.get(modelValue.value) ?? null
);
const selectedLabel = computed(() => selected.value?.displayName ?? '');
const selectedCategory = computed(() =>
    selected.value ? categoryLabel(selected.value.category) : ''
);

// ── Visible sections (query-filtered + grouped) ──

interface Section {
    category: string;
    kinds: readonly GroupKind[];
}

const visibleSections = computed<Section[]>(() => {
    if (!query.value) {
        // No query — show every category in order, sorted within each.
        const out: Section[] = [];
        for (const [category, sectionKinds] of byCategory.value) {
            out.push({category, kinds: sectionKinds});
        }
        out.sort((a, b) => a.category.localeCompare(b.category));
        return out;
    }
    // With query — flatten matches, regroup by category preserving order.
    const matches = search(query.value);
    const grouped = new Map<string, GroupKind[]>();
    for (const k of matches) {
        const bucket = grouped.get(k.category);
        if (bucket) bucket.push(k);
        else grouped.set(k.category, [k]);
    }
    return [...grouped.entries()]
        .map(([category, sectionKinds]) => ({category, kinds: sectionKinds}))
        .sort((a, b) => a.category.localeCompare(b.category));
});

// ── Helpers ──

// Display label for a category id. Replaces underscores with spaces and
// title-cases each word. Examples: `electrical` → `Electrical`,
// `energy_storage` → `Energy Storage`.
function categoryLabel(category: string): string {
    return category
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}

</script>

<style scoped>
.gkp { position: relative; display: flex; flex-direction: column; }

/* ── Trigger ── */
.gkp__trigger {
    display: flex; align-items: center; gap: var(--space-3);
    width: 100%; padding: var(--space-3) var(--space-4);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-body); font-weight: 600;
    cursor: pointer; text-align: left;
    transition: border-color var(--duration-fast), background var(--duration-fast);
}
.gkp__trigger:hover { border-color: var(--color-primary); }
.gkp__trigger--open { border-color: var(--color-primary); }

.gkp__trigger-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gkp__trigger-category {
    font-size: var(--type-caption); font-weight: 500;
    color: var(--color-text-tertiary);
    text-transform: uppercase; letter-spacing: var(--tracking-wide);
}
.gkp__trigger-chevron { color: var(--color-text-tertiary); transition: transform var(--duration-fast); }
.gkp__trigger-chevron--open { transform: rotate(180deg); }

/* ── Panel ── */
.gkp__panel {
    position: absolute; top: calc(100% + var(--space-1)); left: 0; right: 0;
    z-index: var(--z-popover, 100);
    display: flex; flex-direction: column;
    max-height: 420px;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    box-shadow: var(--shadow-popover, var(--card-shadow-contact));
    overflow: hidden;
}
.gkp__spinner { margin: var(--space-5) auto; }

/* Error state for failed catalog fetch — surfaced inline with a Retry
   button. Replaces the previous silent-empty list. */
.gkp__error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    color: var(--color-text-primary);
}
.gkp__error-icon {
    color: var(--color-status-red, var(--color-danger-text));
    margin-top: 2px;
}
.gkp__error-body { flex: 1; }
.gkp__error-msg { margin: 0 0 var(--space-1); font-weight: 600; }
.gkp__error-detail {
    margin: 0; font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}
.gkp__error-retry {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--type-caption); font-weight: 600;
    cursor: pointer;
}
.gkp__error-retry:hover { border-color: var(--color-primary); color: var(--color-primary); }

/* ── Search ── */
.gkp__search {
    display: flex; align-items: center; gap: var(--space-2);
    padding: var(--space-3); border-bottom: 1px solid var(--divider-hairline);
    background: var(--color-surface-2);
}
.gkp__search > i { color: var(--color-text-tertiary); }
.gkp__search-input {
    flex: 1; border: none; outline: none; background: transparent;
    color: var(--color-text-primary); font-size: var(--type-body);
}
.gkp__search-clear {
    background: none; border: none; cursor: pointer; padding: var(--space-1);
    color: var(--color-text-tertiary); border-radius: var(--radius-full);
}
.gkp__search-clear:hover { color: var(--color-text-primary); background: var(--state-hover-bg); }

/* ── List ── */
.gkp__list {
    flex: 1; overflow-y: auto; padding: var(--space-2);
    display: flex; flex-direction: column; gap: var(--space-3);
}

.gkp__section { display: flex; flex-direction: column; gap: var(--space-1); }
.gkp__section-title {
    display: flex; align-items: center; gap: var(--space-2);
    margin: 0; padding: var(--space-2) var(--space-3) var(--space-1);
    font-size: var(--type-caption); font-weight: 700;
    color: var(--color-text-tertiary);
    text-transform: uppercase; letter-spacing: var(--tracking-wide);
}
.gkp__section-count {
    font-size: var(--type-caption); font-weight: 500;
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}

.gkp__option {
    display: flex; flex-direction: column; gap: var(--space-1);
    align-items: flex-start;
    width: 100%; padding: var(--space-2) var(--space-3);
    border: none; border-radius: var(--radius-md);
    background: transparent; color: var(--color-text-primary);
    cursor: pointer; text-align: left;
    transition: background var(--duration-fast), color var(--duration-fast);
}
.gkp__option:hover { background: var(--state-hover-bg); }
.gkp__option--selected {
    background: color-mix(in srgb, var(--color-primary) 14%, transparent);
    color: var(--color-primary);
}
.gkp__option-label { font-size: var(--type-body); font-weight: 600; }
.gkp__option-desc {
    font-size: var(--type-caption); font-weight: 400;
    color: var(--color-text-tertiary); line-height: 1.4;
}

.gkp__empty {
    padding: var(--space-5) var(--space-4); text-align: center;
    color: var(--color-text-disabled); font-size: var(--type-body);
}
</style>
