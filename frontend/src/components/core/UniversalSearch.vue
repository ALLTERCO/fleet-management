<template>
    <div ref="rootRef" class="us">
        <div
            class="search-pill us__pill"
            :class="{'search-pill__input--filtered': hasActiveFilter}"
        >
            <i class="fas fa-search search-pill__icon" />
            <input
                ref="inputRef"
                :value="model"
                type="text"
                class="search-pill__input"
                :placeholder="placeholder"
                :aria-label="placeholder"
                @input="onInput"
                @focus="onFocus"
                @keydown.down.prevent="search.highlightNext"
                @keydown.up.prevent="search.highlightPrev"
                @keydown.enter.prevent="onEnter"
                @keydown.escape.prevent="search.closeDropdown"
            />
            <button
                v-if="model"
                type="button"
                class="search-pill__clear"
                @click="clearQuery"
            >
                <i class="fas fa-xmark" />
            </button>
            <button
                v-if="filterable"
                type="button"
                class="search-pill__filter"
                :class="{'search-pill__filter--active': hasActiveFilter}"
                @click="$emit('filter-click')"
            >
                <i class="fas fa-filter" />
                <span
                    v-if="filterCount && filterCount > 0"
                    class="us__filter-badge"
                >
                    {{ filterCount }}
                </span>
            </button>
        </div>

        <div
            v-if="search.dropdownOpen.value"
            class="us__dropdown"
            role="listbox"
        >
            <div
                v-for="section in search.sections.value"
                :key="section.title"
                class="us__section"
            >
                <h5 class="us__section-title">{{ section.title }}</h5>
                <button
                    v-for="(hit, idx) in section.hits"
                    :key="hit.id"
                    type="button"
                    class="us__hit"
                    :class="{'us__hit--active': indexOfHit(section, idx) === search.highlightIndex.value}"
                    @mouseenter="search.highlightIndex.value = indexOfHit(section, idx)"
                    @click="activate(hit)"
                >
                    <i :class="hit.icon" class="us__hit-icon" />
                    <div class="us__hit-body">
                        <div class="us__hit-label">{{ hit.label }}</div>
                        <div v-if="hit.meta" class="us__hit-meta">
                            {{ hit.meta }}
                        </div>
                    </div>
                    <span class="us__hit-type">{{ hit.type }}</span>
                </button>
            </div>
            <div
                v-if="search.sections.value.length === 0"
                class="us__empty"
            >
                No matches for "{{ search.trimmed.value }}"
            </div>
        </div>
    </div>
</template>

<script setup lang="ts" generic="T">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch
} from 'vue';
import {useRouter} from 'vue-router';
import {
    type PageScope,
    type ResultSection,
    useUniversalSearch
} from '@/composables/useUniversalSearch';
import {registerShortcut} from '@/config/shortcuts';
import type {SearchHit} from '@/helpers/searchSources';

const props = withDefaults(
    defineProps<{
        scope?: PageScope<T>;
        placeholder?: string;
        filterable?: boolean;
        hasActiveFilter?: boolean;
        filterCount?: number;
    }>(),
    {
        placeholder: 'Search…',
        filterable: false,
        hasActiveFilter: false
    }
);

const emit = defineEmits<{'filter-click': []}>();

const model = defineModel<string>({default: ''});

const router = useRouter();
const rootRef = ref<HTMLElement | null>(null);
const inputRef = ref<HTMLInputElement | null>(null);

const search = useUniversalSearch<T>(props.scope);

watch(model, (next) => {
    search.setQuery(next);
    search.resetHighlight();
});

function onInput(e: Event) {
    const value = (e.target as HTMLInputElement).value;
    model.value = value;
    search.openDropdown();
}

function onFocus() {
    if (model.value.trim().length > 0) search.openDropdown();
}

function onEnter() {
    const hit = search.highlighted.value;
    if (hit) activate(hit);
}

function clearQuery() {
    model.value = '';
    search.closeDropdown();
    void nextTick(() => inputRef.value?.focus());
}

function activate(hit: SearchHit) {
    search.closeDropdown();
    model.value = '';
    // A hit may open an inspector/drawer in place instead of navigating.
    if (hit.action) hit.action();
    else router.push(hit.route);
}

function indexOfHit(section: ResultSection, indexWithin: number): number {
    let offset = 0;
    for (const s of search.sections.value) {
        if (s === section) return offset + indexWithin;
        offset += s.hits.length;
    }
    return -1;
}

function onDocClick(e: MouseEvent) {
    if (!search.dropdownOpen.value) return;
    const target = e.target as Node | null;
    if (rootRef.value && target && !rootRef.value.contains(target)) {
        search.closeDropdown();
    }
}

let unregShortcut: (() => void) | null = null;

onMounted(() => {
    document.addEventListener('click', onDocClick);
    unregShortcut = registerShortcut({
        id: 'search.focus',
        description: 'Focus universal search',
        section: 'Global',
        allowInInput: true,
        handler: (e) => {
            e.preventDefault();
            inputRef.value?.focus();
            if (model.value.trim().length > 0) search.openDropdown();
        }
    });
});
onBeforeUnmount(() => {
    document.removeEventListener('click', onDocClick);
    unregShortcut?.();
});
</script>

<style scoped>
.us {
    position: relative;
    width: 100%;
    max-width: var(--search-w-max);
    min-width: 0;
}
.us__pill {
    width: 100%;
}
.us__filter-badge {
    position: absolute;
    top: calc(-1 * var(--space-1));
    right: calc(-1 * var(--space-1));
    min-width: 16px;
    height: 16px;
    padding: 0 var(--space-1);
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-primary);
    background: var(--color-primary);
    border-radius: var(--radius-full);
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.us__dropdown {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    right: 0;
    z-index: 100;
    max-height: var(--dropdown-max-height);
    overflow-y: auto;
    background: var(--dropdown-bg);
    -webkit-backdrop-filter: blur(var(--dropdown-blur)) saturate(1.1);
    backdrop-filter: blur(var(--dropdown-blur)) saturate(1.1);
    border: 1px solid var(--dropdown-border);
    border-radius: var(--dropdown-radius);
    box-shadow: var(--dropdown-shadow);
    padding: var(--space-1);
}
.us__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1) 0;
}
.us__section-title {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-body);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--color-text-tertiary);
}
.us__hit {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-md);
    text-align: left;
    cursor: pointer;
    transition: background var(--duration-fast);
    min-height: var(--touch-target-min);
}
.us__hit:hover,
.us__hit--active {
    background: var(--color-surface-3);
}
.us__hit-icon {
    width: var(--space-5);
    color: var(--color-text-tertiary);
    text-align: center;
    flex-shrink: 0;
}
.us__hit-body {
    flex: 1;
    min-width: 0;
}
.us__hit-label {
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--color-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.us__hit-meta {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.us__hit-type {
    font-size: var(--type-body);
    font-weight: 600;
    padding: var(--space-0-5) var(--space-2);
    background: var(--color-surface-2);
    color: var(--color-text-tertiary);
    border-radius: var(--radius-full);
    flex-shrink: 0;
}
.us__empty {
    padding: var(--space-4);
    text-align: center;
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
</style>
