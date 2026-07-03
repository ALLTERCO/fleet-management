<template>
    <div ref="rootEl" class="fchip" :class="{'fchip--open': open}">
        <button
            type="button"
            class="fchip__pill"
            :aria-expanded="open"
            @click="toggle"
        >
            <span
                v-if="activeOption?.dot"
                class="fchip__dot"
                :class="`fchip__dot--${activeOption.dot}`"
            />
            <span class="fchip__label">{{ label }}</span>
            <span class="fchip__val">{{ activeOption?.label ?? '—' }}</span>
            <i class="fas fa-chevron-down fchip__caret" aria-hidden="true" />
        </button>
        <transition name="fchip-menu">
            <ul v-if="open" class="fchip__menu" role="listbox">
                <li
                    v-for="opt in options"
                    :key="opt.value"
                    class="fchip__item"
                    :class="{'fchip__item--active': opt.value === modelValue}"
                    role="option"
                    :aria-selected="opt.value === modelValue"
                    @click="select(opt.value)"
                >
                    <span
                        v-if="opt.dot"
                        class="fchip__dot"
                        :class="`fchip__dot--${opt.dot}`"
                    />
                    <span class="fchip__item-label">{{ opt.label }}</span>
                    <i
                        v-if="opt.value === modelValue"
                        class="fas fa-check fchip__item-check"
                        aria-hidden="true"
                    />
                </li>
            </ul>
        </transition>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue';

export type FilterDot = 'on' | 'warn' | 'off' | 'alert';

export interface FilterChipOption {
    value: string;
    label: string;
    dot?: FilterDot;
}

const props = defineProps<{
    label: string;
    modelValue: string;
    options: readonly FilterChipOption[];
}>();
const emit = defineEmits<{'update:modelValue': [value: string]}>();

const rootEl = ref<HTMLElement | null>(null);
const open = ref(false);

const activeOption = computed(() =>
    props.options.find((opt) => opt.value === props.modelValue)
);

function toggle(): void {
    open.value = !open.value;
}

function select(value: string): void {
    emit('update:modelValue', value);
    open.value = false;
}

function closeOnOutsideClick(event: MouseEvent): void {
    if (!open.value || !rootEl.value) return;
    if (!rootEl.value.contains(event.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('mousedown', closeOnOutsideClick));
onBeforeUnmount(() =>
    document.removeEventListener('mousedown', closeOnOutsideClick)
);
</script>

<style scoped>
.fchip {
    position: relative;
    display: inline-flex;
}
.fchip__pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 36px;
    padding: 0 var(--space-3-5, 14px);
    border-radius: 18px;
    background: var(--glass-2-bg);
    backdrop-filter: var(--glass-2-filter);
    -webkit-backdrop-filter: var(--glass-2-filter);
    border: 1px solid var(--glass-border);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    white-space: nowrap;
    transition:
        background var(--duration-normal) var(--ease-out-expo),
        border-color var(--duration-normal) var(--ease-out-expo),
        color var(--duration-normal) var(--ease-out-expo);
    /* Doc rule: chips use surface ladder + hairline, no drop shadow. */
}
.fchip__pill:hover {
    background: var(--glass-3-bg);
    color: var(--color-text-primary);
}
.fchip--open .fchip__pill {
    background: rgba(var(--color-primary-rgb), 0.16);
    border-color: rgba(var(--color-primary-rgb), 0.3);
    color: var(--color-text-primary);
}
.fchip__label {
    color: var(--color-text-quaternary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--type-caption);
}
.fchip__val {
    color: var(--color-text-primary);
    font-weight: var(--font-bold);
}
.fchip__caret {
    color: var(--color-text-quaternary);
    font-size: var(--type-caption);
    transition: transform var(--duration-moderate) var(--ease-out-expo);
}
.fchip--open .fchip__caret {
    transform: rotate(180deg);
    color: var(--color-primary);
}
.fchip__dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
}
.fchip__dot--on { background: var(--color-status-on); box-shadow: 0 0 4px var(--color-status-on); }
.fchip__dot--warn { background: var(--color-status-warn); box-shadow: 0 0 4px var(--color-status-warn); }
.fchip__dot--off { background: var(--color-status-off); box-shadow: 0 0 4px var(--color-status-off); }
.fchip__dot--alert { background: var(--color-status-off); animation: blink-err 1.5s ease-in-out infinite; }

.fchip__menu {
    position: absolute;
    top: calc(100% + var(--space-1-5));
    left: 0;
    min-width: 200px;
    margin: 0;
    padding: var(--space-1-5);
    list-style: none;
    background: var(--glass-4-bg);
    backdrop-filter: var(--glass-4-filter);
    -webkit-backdrop-filter: var(--glass-4-filter);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    z-index: 12;
}
.fchip__item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 7px 10px;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition:
        background var(--duration-fast) var(--ease-out-expo),
        color var(--duration-fast) var(--ease-out-expo);
}
.fchip__item:hover {
    background: rgba(var(--color-frost-rgb), 0.06);
    color: var(--color-text-primary);
}
.fchip__item--active {
    background: rgba(var(--color-primary-rgb), 0.16);
    color: var(--color-text-primary);
}
.fchip__item-label { flex: 1; }
.fchip__item-check { color: var(--color-primary); font-size: var(--type-caption); }

.fchip-menu-enter-active,
.fchip-menu-leave-active {
    transition:
        opacity var(--duration-normal) var(--ease-out-expo),
        transform var(--duration-moderate) var(--ease-out-expo);
    transform-origin: top left;
}
.fchip-menu-enter-from,
.fchip-menu-leave-to {
    opacity: 0;
    transform: translateY(-4px) scale(0.96);
}
</style>
