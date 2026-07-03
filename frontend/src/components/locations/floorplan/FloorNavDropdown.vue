<template>
    <div ref="hostRef" class="fnd">
        <button
            type="button"
            class="fnd__trigger"
            :aria-expanded="open"
            aria-haspopup="listbox"
            :title="triggerTitle"
            @click="toggle"
        >
            <i v-if="triggerIcon" :class="['fas', triggerIcon, 'fnd__trigger-icon']" aria-hidden="true" />
            <span class="fnd__trigger-label">{{ triggerLabel }}</span>
            <i class="fas fa-chevron-down fnd__trigger-chev" aria-hidden="true" />
        </button>

        <transition name="fnd-pop">
            <div v-if="open" class="fnd__panel" role="listbox">
                <div
                    v-for="section in sections"
                    :key="section.title"
                    class="fnd__section"
                >
                    <header v-if="section.title" class="fnd__section-hdr">
                        <i
                            v-if="section.icon"
                            :class="['fas', section.icon, 'fnd__section-icon']"
                            aria-hidden="true"
                        />
                        <span class="fnd__section-title">{{ section.title }}</span>
                        <span v-if="section.items.length > 0" class="fnd__section-count">
                            {{ section.items.length }}
                        </span>
                    </header>
                    <ul v-if="section.items.length > 0" class="fnd__list">
                        <li
                            v-for="item in section.items"
                            :key="`${section.title}-${item.id}`"
                            class="fnd__item"
                            :class="{'fnd__item--active': isActive(item)}"
                            role="option"
                            :aria-selected="isActive(item)"
                            tabindex="0"
                            @click="onPick(item)"
                            @keydown.enter.prevent="onPick(item)"
                            @keydown.space.prevent="onPick(item)"
                        >
                            <span
                                v-if="item.colorDot"
                                class="fnd__item-dot"
                                :style="{background: item.colorDot}"
                                aria-hidden="true"
                            />
                            <i
                                v-else-if="item.icon"
                                :class="['fas', item.icon, 'fnd__item-icon']"
                                aria-hidden="true"
                            />
                            <span class="fnd__item-label">{{ item.label }}</span>
                            <span v-if="item.meta" class="fnd__item-meta">{{ item.meta }}</span>
                        </li>
                    </ul>
                    <p v-else class="fnd__empty">{{ section.emptyHint ?? 'Nothing here.' }}</p>
                </div>
            </div>
        </transition>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';

export type FloorNavKind = 'floor' | 'zone' | 'device';

export interface FloorNavItem {
    readonly id: number | string;
    readonly label: string;
    readonly kind: FloorNavKind;
    readonly icon?: string;
    readonly colorDot?: string;
    readonly meta?: string;
}

export interface FloorNavSection {
    readonly title: string;
    readonly icon?: string;
    readonly items: readonly FloorNavItem[];
    readonly emptyHint?: string;
}

const props = defineProps<{
    sections: readonly FloorNavSection[];
    activeId: number | string | null;
    activeKind?: FloorNavKind | null;
    triggerLabel: string;
    triggerIcon?: string;
}>();

const emit = defineEmits<{
    select: [item: FloorNavItem];
}>();

const open = ref(false);
const hostRef = ref<HTMLElement | null>(null);

const triggerTitle = computed(() => (open.value ? 'Close menu' : 'Open menu'));

function isActive(item: FloorNavItem): boolean {
    if (props.activeId == null) return false;
    if (props.activeKind && props.activeKind !== item.kind) return false;
    return item.id === props.activeId;
}

function toggle(): void {
    open.value = !open.value;
}

function onPick(item: FloorNavItem): void {
    emit('select', item);
    open.value = false;
}

function onDocumentPointerDown(event: PointerEvent): void {
    const host = hostRef.value;
    if (!host) return;
    if (event.target instanceof Node && host.contains(event.target)) return;
    open.value = false;
}

function onEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape' && open.value) {
        event.stopPropagation();
        open.value = false;
    }
}

watch(open, (nowOpen) => {
    if (nowOpen) {
        document.addEventListener('pointerdown', onDocumentPointerDown);
        document.addEventListener('keydown', onEscape);
    } else {
        document.removeEventListener('pointerdown', onDocumentPointerDown);
        document.removeEventListener('keydown', onEscape);
    }
});

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown);
    document.removeEventListener('keydown', onEscape);
});
</script>

<style scoped>
.fnd {
    position: relative;
    display: inline-block;
}

.fnd__trigger {
    appearance: none;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 0 var(--space-3);
    background: var(--glass-3-bg);
    backdrop-filter: var(--glass-3-filter);
    -webkit-backdrop-filter: var(--glass-3-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    color: var(--color-text-primary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    box-shadow:
        inset 0 1px 0 var(--glass-highlight),
        0 4px 16px rgba(0, 0, 0, 0.3);
    transition:
        background var(--duration-fast),
        border-color var(--duration-fast);
}

.fnd__trigger:hover,
.fnd__trigger[aria-expanded='true'] {
    background: var(--color-surface-3);
    border-color: var(--color-border-strong);
}

.fnd__trigger-icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-2xs);
}

.fnd__trigger-label {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fnd__trigger-chev {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-2xs);
    margin-left: var(--space-1);
    transition: transform var(--duration-fast);
}

.fnd__trigger[aria-expanded='true'] .fnd__trigger-chev {
    transform: rotate(180deg);
}

.fnd__panel {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    z-index: 10;
    min-width: 260px;
    max-width: 320px;
    max-height: 60vh;
    padding: var(--space-2);
    background: var(--glass-4-bg);
    backdrop-filter: var(--glass-4-filter);
    -webkit-backdrop-filter: var(--glass-4-filter);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    box-shadow:
        inset 0 1px 0 var(--glass-highlight),
        0 12px 36px rgba(0, 0, 0, 0.45);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.fnd__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}

.fnd__section + .fnd__section {
    border-top: 1px solid var(--color-border-default);
    padding-top: var(--space-2);
}

.fnd__section-hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2) var(--space-0-5);
}

.fnd__section-icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-2xs);
}

.fnd__section-title {
    flex: 1;
    font-size: var(--type-caption);
    font-weight: var(--font-bold);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.fnd__section-count {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}

.fnd__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}

.fnd__item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1-5) var(--space-2);
    border-radius: var(--radius-md);
    cursor: pointer;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    transition:
        background var(--duration-fast),
        color var(--duration-fast);
}

.fnd__item:hover,
.fnd__item:focus-visible {
    background: var(--state-hover-bg);
    color: var(--color-text-primary);
    outline: none;
}

.fnd__item--active {
    background: rgba(var(--color-primary-rgb), 0.16);
    color: var(--color-primary-text);
    box-shadow: inset 0 0 0 1px rgba(var(--color-primary-rgb), 0.4);
}

.fnd__item-dot {
    width: 10px;
    height: 10px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
}

.fnd__item-icon {
    width: 14px;
    text-align: center;
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-2xs);
}

.fnd__item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.fnd__item-meta {
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
    font-variant-numeric: tabular-nums;
}

.fnd__empty {
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-quaternary);
}

.fnd-pop-enter-active,
.fnd-pop-leave-active {
    transition:
        opacity var(--duration-fast),
        transform var(--duration-fast);
}

.fnd-pop-enter-from,
.fnd-pop-leave-to {
    opacity: 0;
    transform: translateY(-4px) scale(0.97);
}
</style>
