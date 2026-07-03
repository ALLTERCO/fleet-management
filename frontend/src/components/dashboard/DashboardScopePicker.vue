<template>
    <div class="dsp">
        <button
            ref="triggerRef"
            class="dsp__trigger"
            :class="{'dsp__trigger--scoped': isScoped}"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            @click="menuOpen = !menuOpen"
        >
            <i class="fas fa-filter dsp__icon" aria-hidden="true" />
            <span class="dsp__label">{{ label }}</span>
            <i class="fas fa-chevron-down dsp__chev" aria-hidden="true" />
        </button>

        <div v-if="menuOpen" ref="menuRef" class="dsp__menu" role="menu">
            <button class="dsp__item" role="menuitem" @click="pick({kind: 'fleet'})">
                <i class="fas fa-globe" /> Fleet (all devices)
            </button>
            <div v-if="groups.length > 0" class="dsp__section">
                <div class="dsp__section-label">Groups</div>
                <button
                    v-for="g in groups"
                    :key="`g-${g.id}`"
                    class="dsp__item"
                    role="menuitem"
                    :class="{'dsp__item--active': isPicked('group', g.id)}"
                    @click="pick({kind: 'group', id: g.id})"
                >
                    <i class="fas fa-people-group" /> {{ g.name }}
                </button>
            </div>
            <div v-if="tags.length > 0" class="dsp__section">
                <div class="dsp__section-label">Tags</div>
                <button
                    v-for="t in tags"
                    :key="`t-${t.id}`"
                    class="dsp__item"
                    role="menuitem"
                    :class="{'dsp__item--active': isPicked('tag', t.id)}"
                    @click="pick({kind: 'tag', id: t.id})"
                >
                    <i class="fas fa-tag" /> {{ t.name }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import type {DashboardScope} from '@/composables/useDashboardScope';

interface NamedRecord {
    id: number;
    name: string;
}

const props = defineProps<{
    scope: DashboardScope;
    groups: NamedRecord[];
    tags: NamedRecord[];
}>();

const emit = defineEmits<(e: 'change', scope: DashboardScope) => void>();

const menuOpen = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const menuRef = ref<HTMLElement | null>(null);

const isScoped = computed(() => props.scope.kind !== 'fleet');

// Per-kind label builder. Lookup miss falls back to the kind + id so the
// trigger never goes blank if the parent passes a scope that names a
// group/tag the store hasn't loaded yet.
const LABEL_BUILDERS: Record<
    DashboardScope['kind'],
    (scope: DashboardScope) => string
> = {
    fleet: () => 'Fleet',
    group: (s) =>
        props.groups.find((g) => g.id === s.id)?.name ?? `Group ${s.id}`,
    tag: (s) => props.tags.find((t) => t.id === s.id)?.name ?? `Tag ${s.id}`,
    location: (s) => `Location ${s.id ?? ''}`
};

const label = computed(() => LABEL_BUILDERS[props.scope.kind](props.scope));

function isPicked(kind: DashboardScope['kind'], id: number): boolean {
    return props.scope.kind === kind && props.scope.id === id;
}

function pick(scope: DashboardScope): void {
    emit('change', scope);
    menuOpen.value = false;
}

function onPointerOutside(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (!target) return;
    if (menuRef.value?.contains(target)) return;
    if (triggerRef.value?.contains(target)) return;
    menuOpen.value = false;
}

watch(menuOpen, (isOpen) => {
    if (isOpen) document.addEventListener('pointerdown', onPointerOutside);
    else document.removeEventListener('pointerdown', onPointerOutside);
});

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerOutside);
});
</script>

<style scoped>
.dsp {
    position: relative;
    display: inline-block;
}

.dsp__trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 32px;
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-default);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-body);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        border-color var(--duration-fast) var(--ease-default);
}

.dsp__trigger:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dsp__trigger--scoped {
    border-color: var(--color-primary);
    color: var(--color-primary-text);
    background: var(--color-primary-subtle);
}

.dsp__icon,
.dsp__chev {
    font-size: var(--type-caption);
    color: inherit;
}

.dsp__menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    min-width: 240px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--glass-4-bg);
    backdrop-filter: blur(var(--glass-4-blur));
    -webkit-backdrop-filter: blur(var(--glass-4-blur));
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-xl);
    padding: var(--space-1);
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
}

.dsp__section {
    display: flex;
    flex-direction: column;
    gap: var(--space-px);
    padding-top: var(--space-2);
    border-top: 1px solid var(--color-border-default);
    margin-top: var(--space-1);
}

.dsp__section-label {
    font-size: var(--type-caption);
    text-transform: uppercase;
    font-weight: var(--font-semibold);
    color: var(--color-text-tertiary);
    padding: 0 var(--space-3) var(--space-1);
    letter-spacing: 0.06em;
}

.dsp__item {
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

.dsp__item:hover {
    background-color: var(--glass-hover);
    color: var(--color-text-primary);
}

.dsp__item--active {
    background-color: var(--color-primary-subtle);
    color: var(--color-primary-text);
}
</style>
