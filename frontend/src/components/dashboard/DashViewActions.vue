<template>
    <div class="dva" role="toolbar" aria-label="Dashboard actions">
        <div class="dva__menu-wrap">
            <button
                ref="menuTriggerRef"
                class="dva__btn"
                :class="{'dva__btn--active': menuOpen}"
                aria-label="More actions"
                :aria-expanded="menuOpen"
                aria-haspopup="menu"
                @click="menuOpen = !menuOpen"
            >
                <i class="fas fa-ellipsis-vertical" aria-hidden="true" />
            </button>

            <div v-if="menuOpen" ref="menuRef" class="dva__menu" role="menu">
                <button
                    class="dva__menu-item"
                    :disabled="loading"
                    role="menuitem"
                    aria-label="Refresh dashboard"
                    @click="onMenuChoice('refresh')"
                >
                    <i
                        class="fas fa-arrows-rotate"
                        :class="{'fa-spin': loading}"
                        aria-hidden="true"
                    />
                    Refresh dashboard
                </button>
                <button
                    v-if="actions.canShare"
                    class="dva__menu-item"
                    role="menuitem"
                    aria-label="Share dashboard"
                    @click="onMenuChoice('share')"
                >
                    <i class="fas fa-share-nodes" aria-hidden="true" />
                    Share dashboard
                </button>
                <button
                    v-if="actions.onOpenSettings"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('open-settings')"
                >
                    <i class="fas fa-gear" aria-hidden="true" />
                    {{ actions.settingsLabel ?? 'Dashboard settings' }}
                </button>
                <hr class="dva__menu-sep" />
                <button
                    v-if="actions.canEdit"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('toggle-edit')"
                >
                    <i class="fas fa-pen-ruler" aria-hidden="true" />
                    Edit dashboard
                </button>
                <button
                    v-if="actions.canEdit"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('add-widget')"
                >
                    <i class="fas fa-plus" aria-hidden="true" />
                    Add widget
                </button>
                <hr v-if="actions.canEdit" class="dva__menu-sep" />
                <button
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('open-manage')"
                >
                    <i class="fas fa-table-cells-large" aria-hidden="true" />
                    Manage dashboards
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import type {DashChromeActions} from '@/stores/dashboardChrome';

const props = defineProps<{actions: DashChromeActions}>();
const loading = computed(() => props.actions.loading);
const menuOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);
const menuTriggerRef = ref<HTMLElement | null>(null);

type MenuChoice =
    | 'refresh'
    | 'share'
    | 'open-settings'
    | 'toggle-edit'
    | 'add-widget'
    | 'open-manage';
const MENU_HANDLERS: Record<MenuChoice, () => void> = {
    refresh: () => props.actions.onRefresh(),
    share: () => props.actions.onShare(),
    'open-settings': () => props.actions.onOpenSettings?.(),
    'toggle-edit': () => props.actions.onToggleEdit(),
    'add-widget': () => props.actions.onAddWidget(),
    'open-manage': () => props.actions.onOpenManage()
};

function onMenuChoice(choice: MenuChoice): void {
    menuOpen.value = false;
    MENU_HANDLERS[choice]();
}

function onPointerDownOutside(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (!target) return;
    if (menuRef.value?.contains(target)) return;
    if (menuTriggerRef.value?.contains(target)) return;
    menuOpen.value = false;
}

function onEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') menuOpen.value = false;
}

watch(menuOpen, (open) => {
    if (open) {
        document.addEventListener('pointerdown', onPointerDownOutside);
        document.addEventListener('keydown', onEscape);
    } else {
        document.removeEventListener('pointerdown', onPointerDownOutside);
        document.removeEventListener('keydown', onEscape);
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDownOutside);
    document.removeEventListener('keydown', onEscape);
});
</script>

<style scoped>
.dva {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
}

.dva__btn {
    width: var(--btn-h-sm);
    height: var(--btn-h-sm);
    border-radius: 50%;
    background: transparent;
    border: 1px solid transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--color-text-disabled);
    flex-shrink: 0;
    transition: background var(--duration-fast), border-color
        var(--duration-fast), color var(--duration-fast);
}
.dva__btn:hover:not(:disabled) {
    background: rgba(var(--color-frost-rgb), 0.06);
    border-color: var(--color-border-default);
    color: var(--color-text-secondary);
}
.dva__btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.dva__btn--active {
    background: rgba(var(--color-frost-rgb), 0.08);
    color: var(--color-text-primary);
}

.dva__menu-wrap {
    position: relative;
}
.dva__menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    min-width: 220px;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-card);
    padding: var(--space-1);
    z-index: var(--z-overlay);
    display: flex;
    flex-direction: column;
}
.dva__menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.dva__menu-item:hover {
    background: rgba(var(--color-frost-rgb), 0.08);
}
.dva__menu-item:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}
.dva__menu-item:disabled:hover {
    background: transparent;
}
.dva__menu-sep {
    border: 0;
    border-top: 1px solid var(--color-border-default);
    margin: var(--space-1) 0;
}
</style>
