<template>
    <div class="dva" role="toolbar" aria-label="Dashboard actions">
        <div class="dva__menu-wrap">
            <button
                ref="menuTriggerRef"
                type="button"
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
                <!-- Dashboard-specific actions (only when a page registered chrome) -->
                <button
                    v-if="actions?.canEdit"
                    type="button"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('edit')"
                >
                    <i class="fas fa-pen-to-square" aria-hidden="true" />
                    Edit dashboard
                </button>
                <button
                    v-if="actions?.canEdit"
                    type="button"
                    class="dva__menu-item"
                    role="menuitem"
                    :disabled="actions.isDefault"
                    @click="onMenuChoice('set-default')"
                >
                    <i class="fas fa-star" aria-hidden="true" />
                    Set as default
                    <i
                        v-if="actions.isDefault"
                        class="fas fa-check dva__menu-check"
                        aria-hidden="true"
                    />
                </button>
                <button
                    v-if="canDuplicate"
                    type="button"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('duplicate')"
                >
                    <i class="fas fa-clone" aria-hidden="true" />
                    Duplicate
                </button>
                <button
                    v-if="actions?.canShare"
                    type="button"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('share')"
                >
                    <i class="fas fa-share-nodes" aria-hidden="true" />
                    Share dashboard
                </button>

                <hr v-if="hasDashboardActions" class="dva__menu-sep" />

                <!-- Global lifecycle / navigation -->
                <button
                    type="button"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('create')"
                >
                    <i class="fas fa-plus" aria-hidden="true" />
                    Create dashboard
                </button>
                <button
                    type="button"
                    class="dva__menu-item"
                    role="menuitem"
                    @click="onMenuChoice('manage')"
                >
                    <i class="fas fa-table-cells-large" aria-hidden="true" />
                    Manage dashboards
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, inject, onBeforeUnmount, ref, watch} from 'vue';
import {OPEN_DASHBOARD_PALETTE_KEY} from '@/helpers/dashboardKeys';
import type {DashChromeActions} from '@/stores/dashboardChrome';

// Nullable: pages that don't register chrome (map, analytics) still get the
// ⋮ with Create / Manage — only the dashboard-specific items are page-gated.
const props = defineProps<{actions: DashChromeActions | null}>();

// Provided by the /dash shell (pages/dash.vue). Opens the dashboard palette in
// list mode ("Manage dashboards") or create mode ("Create dashboard").
const openPalette = inject(OPEN_DASHBOARD_PALETTE_KEY);

const menuOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);
const menuTriggerRef = ref<HTMLElement | null>(null);

const canDuplicate = computed(
    () => props.actions?.kind === 'bento' && !!props.actions.onDuplicate
);
const hasDashboardActions = computed(
    () =>
        Boolean(props.actions?.canEdit) ||
        canDuplicate.value ||
        Boolean(props.actions?.canShare)
);

type MenuChoice =
    | 'edit'
    | 'set-default'
    | 'duplicate'
    | 'share'
    | 'create'
    | 'manage';
const MENU_HANDLERS: Record<MenuChoice, () => void> = {
    edit: () => props.actions?.onEdit(),
    'set-default': () => props.actions?.onSetDefault(),
    duplicate: () => props.actions?.onDuplicate?.(),
    share: () => props.actions?.onShare?.(),
    create: () => openPalette?.({mode: 'create'}),
    manage: () => openPalette?.({mode: 'list'})
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
    box-shadow: var(--shadow-md);
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
.dva__menu-check {
    margin-left: auto;
    color: var(--color-primary);
}
.dva__menu-sep {
    border: 0;
    border-top: 1px solid var(--color-border-default);
    margin: var(--space-1) 0;
}
</style>
