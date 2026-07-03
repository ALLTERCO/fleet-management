<template>
    <div
        :id="idAttr"
        class="dpr"
        :class="{
            'dpr--active': active,
            'dpr--highlighted': highlighted
        }"
        role="option"
        :aria-selected="active"
        @mouseenter="onHover"
        @click="onClick"
    >
        <DashboardTypeIcon :type="row.type" />


        <template v-if="inlineMode === 'rename'">
            <input
                ref="renameInput"
                class="dpr__rename"
                :value="draftName"
                aria-label="New name"
                @input="$emit('update:draft', ($event.target as HTMLInputElement).value)"
                @keydown.enter.stop.prevent="$emit('commit-rename')"
                @keydown.esc.stop.prevent="$emit('cancel-rename')"
                @click.stop
            />
        </template>

        <template v-else-if="inlineMode === 'delete'">
            <span class="dpr__delete-text">Delete "{{ row.name }}"?</span>
        </template>

        <template v-else>
            <div class="dpr__main">
                <div class="dpr__name">
                    {{ row.name }}
                    <span v-if="row.isDefault" class="dpr__default">Default</span>
                </div>
                <div class="dpr__meta">
                    <span class="dpr__type">{{ typeLabel(row.type) }}</span>
                    <span v-if="row.widgetCount > 0" class="dpr__widget-count">
                        · {{ row.widgetCount }} widget{{ row.widgetCount === 1 ? '' : 's' }}
                    </span>
                </div>
            </div>
        </template>

        <div class="dpr__actions" @click.stop>
            <template v-if="inlineMode === 'rename'">
                <button
                    class="dpr__btn dpr__btn--primary"
                    aria-label="Save name"
                    @click="$emit('commit-rename')"
                >
                    <i class="fas fa-check" />
                </button>
                <button
                    class="dpr__btn"
                    aria-label="Cancel rename"
                    @click="$emit('cancel-rename')"
                >
                    <i class="fas fa-xmark" />
                </button>
            </template>

            <template v-else-if="inlineMode === 'delete'">
                <button
                    class="dpr__btn dpr__btn--danger"
                    aria-label="Confirm delete"
                    @click="$emit('confirm-delete')"
                >
                    Delete
                </button>
                <button
                    class="dpr__btn"
                    aria-label="Cancel delete"
                    @click="$emit('cancel-delete')"
                >
                    Cancel
                </button>
            </template>

            <template v-else>
                <button
                    v-if="canRename || canDelete"
                    class="dpr__kebab"
                    :class="{'dpr__kebab--open': menuOpen}"
                    aria-label="Row actions"
                    @click="onKebab"
                >
                    <i class="fas fa-ellipsis-vertical" />
                </button>
                <div v-if="menuOpen" class="dpr__menu" role="menu">
                    <button
                        v-if="canRename"
                        class="dpr__menu-item"
                        role="menuitem"
                        @click="$emit('start-rename')"
                    >
                        <i class="fas fa-pen" /> Rename
                    </button>
                    <button
                        class="dpr__menu-item"
                        role="menuitem"
                        :disabled="isFirst"
                        @click="$emit('move-up')"
                    >
                        <i class="fas fa-arrow-up" /> Move up
                    </button>
                    <button
                        class="dpr__menu-item"
                        role="menuitem"
                        :disabled="isLast"
                        @click="$emit('move-down')"
                    >
                        <i class="fas fa-arrow-down" /> Move down
                    </button>
                    <button
                        v-if="canDelete"
                        class="dpr__menu-item dpr__menu-item--danger"
                        role="menuitem"
                        @click="$emit('start-delete')"
                    >
                        Delete
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import {nextTick, ref, watch} from 'vue';
import DashboardTypeIcon from '@/components/dashboard/DashboardTypeIcon.vue';
import {type PaletteRow, typeLabel} from '@/helpers/dashboardPalette';

const props = defineProps<{
    row: PaletteRow;
    active: boolean;
    highlighted: boolean;
    idAttr: string;
    menuOpen: boolean;
    inlineMode: 'rename' | 'delete' | null;
    draftName: string;
    canRename: boolean;
    canDelete: boolean;
    isFirst: boolean;
    isLast: boolean;
}>();

const emit = defineEmits<{
    (e: 'activate'): void;
    (e: 'open-menu'): void;
    (e: 'close-menu'): void;
    (e: 'start-rename'): void;
    (e: 'commit-rename'): void;
    (e: 'cancel-rename'): void;
    (e: 'update:draft', value: string): void;
    (e: 'start-delete'): void;
    (e: 'confirm-delete'): void;
    (e: 'cancel-delete'): void;
    (e: 'move-up'): void;
    (e: 'move-down'): void;
}>();

const renameInput = ref<HTMLInputElement | null>(null);

watch(
    () => props.inlineMode,
    async (mode) => {
        if (mode !== 'rename') return;
        await nextTick();
        renameInput.value?.focus();
        renameInput.value?.select();
    }
);

function onClick(): void {
    if (props.inlineMode !== null) return;
    emit('activate');
}

function onHover(): void {
    // Parent handles outside-click close.
}

function onKebab(): void {
    if (props.menuOpen) emit('close-menu');
    else emit('open-menu');
}
</script>

<style scoped>
.dpr {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    margin: var(--space-px) 0;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.dpr:hover,
.dpr--highlighted {
    background-color: var(--glass-hover);
}

.dpr--active {
    background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

.dpr--active .dpr__name {
    color: var(--color-primary-text);
}


.dpr__main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.dpr__name {
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
    display: flex;
    align-items: center;
    gap: var(--space-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.dpr__default {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-tertiary);
    background: var(--color-surface-3);
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-sm);
}

.dpr__meta {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
}

.dpr__type {
    text-transform: capitalize;
}

.dpr__rename {
    flex: 1;
    min-width: 0;
    background: var(--glass-input);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--type-body);
    padding: var(--space-1-5) var(--space-2);
    outline: none;
}

.dpr__delete-text {
    flex: 1;
    color: var(--color-danger-text);
    font-size: var(--type-body);
}

.dpr__actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
    position: relative;
}

.dpr__btn {
    min-height: var(--touch-target-min);
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.dpr__btn:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dpr__btn--primary {
    background: var(--color-primary);
    border-color: var(--color-primary);
    color: var(--color-text-inverse);
}

.dpr__btn--primary:hover {
    background: var(--color-primary-hover);
    color: var(--color-text-inverse);
}

.dpr__btn--danger {
    background: var(--color-danger);
    border-color: var(--color-danger);
    color: var(--color-text-inverse);
}

.dpr__btn--danger:hover {
    background: var(--color-danger-hover);
    color: var(--color-text-inverse);
}

.dpr__kebab {
    width: var(--touch-target-min);
    height: var(--touch-target-min);
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition:
        opacity var(--duration-fast) var(--ease-default),
        background-color var(--duration-fast) var(--ease-default);
}

.dpr:hover .dpr__kebab,
.dpr--highlighted .dpr__kebab,
.dpr__kebab--open {
    opacity: 1;
}

.dpr__kebab:hover,
.dpr__kebab--open {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dpr__menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    min-width: 180px;
    background: var(--glass-4-bg);
    backdrop-filter: blur(var(--glass-4-blur));
    -webkit-backdrop-filter: blur(var(--glass-4-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-xl);
    padding: var(--space-1);
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
}

.dpr__menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}

.dpr__menu-item:hover:not(:disabled) {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dpr__menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.dpr__menu-item--danger {
    color: var(--color-danger-text);
}

.dpr__menu-item--danger:hover {
    background-color: var(--color-danger-subtle);
    color: var(--color-danger-text);
}
</style>
