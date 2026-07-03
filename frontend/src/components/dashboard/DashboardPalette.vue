<template>
    <Teleport to="body">
        <Transition name="dp-fade">
            <div
                v-if="visible"
                class="dp-scrim"
                role="presentation"
                @click="$emit('close')"
            >
                <div
                    ref="panelRef"
                    class="dp-panel"
                    role="dialog"
                    aria-modal="true"
                    :aria-label="ariaLabel"
                    tabindex="-1"
                    @click.stop
                    @keydown="handleKeydown"
                >
                    <div class="dp-search">
                        <i class="fas fa-magnifying-glass dp-search__icon" />
                        <input
                            ref="searchInput"
                            v-model="query"
                            class="dp-search__input"
                            type="text"
                            :placeholder="searchPlaceholder"
                            spellcheck="false"
                            autocomplete="off"
                            @input="onSearchInput"
                        />
                        <kbd v-if="query.length === 0" class="kbd dp-search__hint">
                            /
                        </kbd>
                        <button
                            class="dp-search__close"
                            aria-label="Close"
                            @click="$emit('close')"
                        >
                            <i class="fas fa-xmark" />
                        </button>
                    </div>

                    <div class="dp-body" role="listbox" :aria-activedescendant="activeRowId">
                        <DashboardPaletteCreate
                            v-if="mode === 'create'"
                            :seed-name="query.trim()"
                            :creating="creating"
                            @submit="onSubmitCreate"
                            @cancel="mode = 'list'"
                        />

                        <template v-else-if="!hasMatches">
                            <div class="dp-empty">
                                <i class="fas fa-circle-info dp-empty__icon" />
                                <p class="dp-empty__title">
                                    {{ emptyTitle }}
                                </p>
                                <p v-if="canCreate" class="dp-empty__hint">
                                    Press
                                    <kbd class="kbd">{{ createShortcutLabel }}</kbd>
                                    to create
                                    {{ query.length > 0 ? 'one' : 'your first dashboard' }}.
                                </p>
                            </div>
                        </template>

                        <template v-else-if="query.length === 0">
                            <DpSection
                                v-for="section in emptyState.sections"
                                :key="section.key"
                                :label="section.label"
                            >
                                <DpRow
                                    v-for="(row, idx) in section.rows"
                                    :key="section.key + '-' + row.id"
                                    :row="row"
                                    :active="String(row.id) === String(activeId)"
                                    :highlighted="flatRows[highlightedIndex ?? -1] === row"
                                    :id-attr="rowDomId(row, section.key + '-' + idx)"
                                    :menu-open="openMenuKey === section.key + '-' + row.id"
                                    :inline-mode="rowInlineMode(row, section.key + '-' + row.id)"
                                    :draft-name="renameDraft"
                                    :can-rename="canRename(row.id)"
                                    :can-delete="canDelete(row.id)"
                                    :is-first="false"
                                    :is-last="false"
                                    @activate="onActivate(row)"
                                    @open-menu="openMenu(section.key + '-' + row.id)"
                                    @close-menu="closeMenu"
                                    @start-rename="startRename(row, section.key + '-' + row.id)"
                                    @commit-rename="commitRename(row)"
                                    @cancel-rename="cancelInline"
                                    @update:draft="renameDraft = $event"
                                    @start-delete="startDelete(section.key + '-' + row.id)"
                                    @confirm-delete="confirmDelete(row)"
                                    @cancel-delete="cancelInline"
                                    @move-up="$emit('move', row.id, -1)"
                                    @move-down="$emit('move', row.id, 1)"
                                />
                            </DpSection>
                        </template>

                        <template v-else>
                            <DpSection
                                v-for="section in resultSections"
                                :key="section.typeKey"
                                :label="section.label"
                            >
                                <DpRow
                                    v-for="(row, idx) in section.rows"
                                    :key="'s-' + section.typeKey + '-' + row.id"
                                    :row="row"
                                    :active="String(row.id) === String(activeId)"
                                    :highlighted="flatRows[highlightedIndex ?? -1] === row"
                                    :id-attr="rowDomId(row, section.typeKey + '-' + idx)"
                                    :menu-open="openMenuKey === 's-' + row.id"
                                    :inline-mode="rowInlineMode(row, 's-' + row.id)"
                                    :draft-name="renameDraft"
                                    :can-rename="canRename(row.id)"
                                    :can-delete="canDelete(row.id)"
                                    :is-first="false"
                                    :is-last="false"
                                    @activate="onActivate(row)"
                                    @open-menu="openMenu('s-' + row.id)"
                                    @close-menu="closeMenu"
                                    @start-rename="startRename(row, 's-' + row.id)"
                                    @commit-rename="commitRename(row)"
                                    @cancel-rename="cancelInline"
                                    @update:draft="renameDraft = $event"
                                    @start-delete="startDelete('s-' + row.id)"
                                    @confirm-delete="confirmDelete(row)"
                                    @cancel-delete="cancelInline"
                                    @move-up="$emit('move', row.id, -1)"
                                    @move-down="$emit('move', row.id, 1)"
                                />
                            </DpSection>
                        </template>

                        <button
                            v-if="canCreate && mode === 'list'"
                            class="dp-create"
                            :class="{'dp-create--highlighted': isCreateHighlighted}"
                            @click="enterCreateMode"
                        >
                            <span class="dp-create__icon">
                                <i class="fas fa-plus" />
                            </span>
                            <span class="dp-create__label">
                                {{ query.trim().length > 0 ? `Create "${query.trim()}"` : 'New dashboard' }}
                            </span>
                            <kbd class="kbd dp-create__hint">{{ createShortcutLabel }}</kbd>
                        </button>
                    </div>

                    <div class="dp-footer">
                        <span class="dp-footer__group">
                            <kbd class="kbd">↑</kbd>
                            <kbd class="kbd">↓</kbd>
                            navigate
                        </span>
                        <span class="dp-footer__group">
                            <kbd class="kbd">↵</kbd>
                            open
                        </span>
                        <span class="dp-footer__group">
                            <kbd class="kbd">Esc</kbd>
                            close
                        </span>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import {computed, nextTick, ref, toRef, watch} from 'vue';
import DashboardPaletteCreate, {
    type CreateSubmitPayload
} from '@/components/dashboard/DashboardPaletteCreate.vue';
import DpRow from '@/components/dashboard/DashboardPaletteRow.vue';
import DpSection from '@/components/dashboard/DashboardPaletteSection.vue';
import {useFocusTrap} from '@/composables/useFocusTrap';
import {useFuzzySearch} from '@/composables/useFuzzySearch';
import {
    flattenSections,
    groupRowsByType,
    nextHighlightIndex,
    type PaletteRow,
    paletteEmptyState
} from '@/helpers/dashboardPalette';
import {isApplePlatform} from '@/helpers/platform';

const props = defineProps<{
    visible: boolean;
    rows: readonly PaletteRow[];
    activeId: number | string | null;
    recentIds: readonly (number | string)[];
    canCreate: boolean;
    creating?: boolean;
    initialMode?: 'list' | 'create';
    canRename: (id: number | string) => boolean;
    canDelete: (id: number | string) => boolean;
}>();

const emit = defineEmits<{
    (e: 'close'): void;
    (e: 'open', id: number | string): void;
    (e: 'create', payload: CreateSubmitPayload): void;
    (e: 'rename', id: number | string, name: string): void;
    (e: 'delete', id: number | string): void;
    (e: 'move', id: number | string, direction: -1 | 1): void;
}>();

const ariaLabel = 'Dashboard switcher';
const searchPlaceholder = 'Search dashboards or create new…';
const createShortcutLabel = isApplePlatform() ? '⌘N' : 'Ctrl+N';

const panelRef = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const query = ref('');
const highlightedIndex = ref<number | null>(null);
const openMenuKey = ref<string | null>(null);
const renameDraft = ref('');
const inlineMode = ref<'rename' | 'delete' | null>(null);
const inlineRowKey = ref<string | null>(null);
const mode = ref<'list' | 'create'>('list');

const {handleKeydown: handleTrapKeydown} = useFocusTrap(
    panelRef,
    toRef(props, 'visible'),
    () => emit('close')
);

const fuzzyMatches = useFuzzySearch(() => props.rows as PaletteRow[], query, {
    keys: ['name']
});

const emptyState = computed(() =>
    paletteEmptyState(props.rows, props.recentIds)
);

const resultSections = computed(() => groupRowsByType(fuzzyMatches.value));

const flatRows = computed<readonly PaletteRow[]>(() => {
    if (query.value.length === 0) {
        return emptyState.value.sections.flatMap((s) => s.rows);
    }
    return flattenSections(resultSections.value);
});

const hasMatches = computed(() => flatRows.value.length > 0);

const emptyTitle = computed(() => {
    if (query.value.length === 0) return 'No dashboards yet';
    return `No dashboards match "${query.value}"`;
});

const isCreateHighlighted = computed(
    () =>
        props.canCreate &&
        highlightedIndex.value !== null &&
        highlightedIndex.value === flatRows.value.length
);

const activeRowId = computed(() => {
    const idx = highlightedIndex.value;
    if (idx === null) return undefined;
    if (props.canCreate && idx === flatRows.value.length)
        return 'dp-create-row';
    const row = flatRows.value[idx];
    return row ? `dp-row-${row.id}` : undefined;
});

watch(
    () => props.visible,
    async (visible) => {
        if (!visible) {
            query.value = '';
            highlightedIndex.value = null;
            mode.value = 'list';
            cancelInline();
            closeMenu();
            return;
        }
        await nextTick();
        mode.value = props.initialMode ?? 'list';
        if (searchInput.value) searchInput.value.focus();
        else panelRef.value?.focus();
    },
    {immediate: true}
);

// Re-seed highlight whenever the visible row set changes, not just on query —
// fuzzy results lag a tick, so watching query alone leaves stale indices.
// With zero rows but canCreate, point at the create-virtual-row instead.
watch(
    () => flatRows.value.length,
    (length) => {
        if (length > 0) highlightedIndex.value = 0;
        else if (props.canCreate) highlightedIndex.value = 0;
        else highlightedIndex.value = null;
    }
);

function onSearchInput(): void {
    cancelInline();
    closeMenu();
}

function rowDomId(row: PaletteRow, suffix: string): string {
    return `dp-row-${row.id}-${suffix}`;
}

function rowInlineMode(
    _row: PaletteRow,
    key: string
): 'rename' | 'delete' | null {
    return inlineRowKey.value === key ? inlineMode.value : null;
}

function openMenu(key: string): void {
    openMenuKey.value = key;
}

function closeMenu(): void {
    openMenuKey.value = null;
}

function startRename(row: PaletteRow, key: string): void {
    inlineMode.value = 'rename';
    inlineRowKey.value = key;
    renameDraft.value = row.name;
    closeMenu();
}

function commitRename(row: PaletteRow): void {
    const draft = renameDraft.value.trim();
    if (draft.length > 0 && draft !== row.name) {
        emit('rename', row.id, draft);
    }
    cancelInline();
}

function startDelete(key: string): void {
    inlineMode.value = 'delete';
    inlineRowKey.value = key;
    closeMenu();
}

function confirmDelete(row: PaletteRow): void {
    emit('delete', row.id);
    cancelInline();
}

function cancelInline(): void {
    inlineMode.value = null;
    inlineRowKey.value = null;
    renameDraft.value = '';
}

function onActivate(row: PaletteRow): void {
    if (inlineMode.value !== null) return;
    emit('open', row.id);
    emit('close');
}

function enterCreateMode(): void {
    mode.value = 'create';
    cancelInline();
    closeMenu();
}

function onSubmitCreate(payload: CreateSubmitPayload): void {
    emit('create', payload);
}

function handleKeydown(event: KeyboardEvent): void {
    // Delegate Tab to the focus trap; it returns control for other keys.
    if (event.key === 'Tab') {
        handleTrapKeydown(event);
        return;
    }
    if (event.key === 'Escape') {
        if (inlineMode.value !== null) {
            cancelInline();
            event.preventDefault();
            return;
        }
        if (openMenuKey.value !== null) {
            closeMenu();
            event.preventDefault();
            return;
        }
        if (mode.value === 'create') {
            mode.value = 'list';
            event.preventDefault();
            return;
        }
        emit('close');
        event.preventDefault();
        return;
    }

    if (inlineMode.value !== null) return;
    if (mode.value === 'create') return;

    if (isCreateShortcut(event)) {
        event.preventDefault();
        enterCreateMode();
        return;
    }

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveHighlight('down');
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveHighlight('up');
        return;
    }

    if (event.key === 'Enter') {
        event.preventDefault();
        activateHighlighted();
    }
}

function isCreateShortcut(event: KeyboardEvent): boolean {
    const mod = event.metaKey || event.ctrlKey;
    return mod && event.key.toLowerCase() === 'n' && props.canCreate;
}

function moveHighlight(direction: 'up' | 'down'): void {
    const total = flatRows.value.length + (props.canCreate ? 1 : 0);
    const next = nextHighlightIndex(total, highlightedIndex.value, direction);
    highlightedIndex.value = next;
}

function activateHighlighted(): void {
    const idx = highlightedIndex.value;
    if (idx === null) return;
    if (props.canCreate && idx === flatRows.value.length) {
        enterCreateMode();
        return;
    }
    const row = flatRows.value[idx];
    if (row) onActivate(row);
}
</script>

<style scoped>
.dp-scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    background: rgba(var(--color-surface-bg-rgb), 0.55);
    backdrop-filter: blur(var(--scrim-blur));
    -webkit-backdrop-filter: blur(var(--scrim-blur));
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
}

.dp-panel {
    width: min(640px, 92vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--glass-5-bg);
    backdrop-filter: blur(var(--glass-5-blur));
    -webkit-backdrop-filter: blur(var(--glass-5-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-2xl);
    overflow: hidden;
    outline: none;
}

.dp-search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-4);
    border-bottom: 1px solid var(--color-border-default);
}

.dp-search__icon {
    color: var(--color-text-tertiary);
    font-size: var(--type-body);
}

.dp-search__input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--color-text-primary);
    font-size: var(--type-subheading);
    font-weight: var(--font-medium);
    padding: 0;
}

.dp-search__input::placeholder {
    color: var(--color-text-tertiary);
    font-weight: var(--font-normal);
}

.dp-search__hint {
    opacity: 0.7;
}

.dp-search__close {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.dp-search__close:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dp-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--space-2) var(--space-2) var(--space-3);
    scrollbar-width: thin;
}

.dp-empty {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--color-text-tertiary);
}

.dp-empty__icon {
    font-size: var(--icon-size-xl);
    color: var(--color-text-quaternary);
    margin-bottom: var(--space-3);
}

.dp-empty__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    margin: 0 0 var(--space-2);
}

.dp-empty__hint {
    font-size: var(--type-caption);
    margin: 0;
}

.dp-create {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    margin-top: var(--space-2);
    padding: var(--space-3) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px dashed var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    cursor: pointer;
    text-align: left;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}

.dp-create:hover,
.dp-create--highlighted {
    background-color: var(--glass-hover);
    border-color: var(--color-primary);
    color: var(--color-text-primary);
}

.dp-create__icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--color-primary-subtle);
    color: var(--color-primary-text);
    font-size: var(--type-body);
    flex-shrink: 0;
    position: relative;
}

.dp-create__icon::after {
    content: "";
    position: absolute;
    inset: -8px;
}

.dp-create__label {
    flex: 1;
    min-width: 0;
}

.dp-create__hint {
    flex-shrink: 0;
}

.dp-footer {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--color-border-default);
    background: var(--glass-hover);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}

.dp-footer__group {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
}

.kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    padding: var(--kbd-padding-y) var(--kbd-padding-x);
    background: var(--kbd-bg);
    color: var(--kbd-fg);
    border: 1px solid var(--kbd-border);
    border-radius: var(--kbd-radius);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    line-height: 1;
}

.dp-fade-enter-active,
.dp-fade-leave-active {
    transition: opacity var(--duration-fast) var(--ease-default);
}
.dp-fade-enter-active .dp-panel,
.dp-fade-leave-active .dp-panel {
    transition:
        transform var(--duration-normal) var(--ease-out),
        opacity var(--duration-normal) var(--ease-out);
}
.dp-fade-enter-from,
.dp-fade-leave-to {
    opacity: 0;
}
.dp-fade-enter-from .dp-panel,
.dp-fade-leave-to .dp-panel {
    transform: translateY(-12px) scale(0.98);
    opacity: 0;
}
</style>
