<template>
    <div class="scope-mode">
        <div
            class="scope-mode__opts"
            role="radiogroup"
            aria-label="Resource scope"
        >
            <label
                v-for="opt in SCOPE_OPTIONS"
                :key="opt.value"
                class="scope-mode__opt"
                :class="{
                    'scope-mode__opt--active':
                        scopeAll === (opt.value === 'all')
                }"
            >
                <input
                    type="radio"
                    :value="opt.value"
                    :checked="scopeAll === (opt.value === 'all')"
                    class="scope-mode__input"
                    @change="scopeAll = opt.value === 'all'"
                />
                <i :class="`fas ${opt.icon} scope-mode__icon`" />
                <span class="scope-mode__body">
                    <span class="scope-mode__label">{{ opt.label }}</span>
                    <span class="scope-mode__hint">{{ opt.hint }}</span>
                </span>
            </label>
        </div>
        <BoundaryScopePicker
            v-if="!scopeAll"
            v-model="scope"
            :persona-key="personaKey"
        />
    </div>
</template>

<script setup lang="ts">
import BoundaryScopePicker from '@/components/core/BoundaryScopePicker.vue';
import type {ScopeSelection} from '@/helpers/scopeDimensions';

const scopeAll = defineModel<boolean>('scopeAll', {required: true});
const scope = defineModel<ScopeSelection>('scope', {required: true});

defineProps<{
    // System-role key of the picked role; narrows offered scope kinds.
    personaKey?: string;
}>();

const SCOPE_OPTIONS = [
    {
        value: 'all',
        label: 'Everything the role covers',
        hint: 'Full access to whatever this role allows.',
        icon: 'fa-globe'
    },
    {
        value: 'scoped',
        label: 'Only specific things',
        hint: 'Pick the exact devices, dashboards, or other resources.',
        icon: 'fa-filter'
    }
] as const;
</script>

<style scoped>
.scope-mode {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
}
.scope-mode__opts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-2);
}
.scope-mode__opt {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border-medium);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
        border-color var(--motion-hover),
        background var(--motion-hover);
}
.scope-mode__opt:hover {
    border-color: var(--color-border-strong);
    background: var(--color-surface-2);
}
.scope-mode__opt--active {
    border-color: var(--color-primary);
    background: color-mix(
        in srgb,
        var(--color-primary) 12%,
        var(--color-surface-2)
    );
    box-shadow: var(--shadow-brand-ring);
}
.scope-mode__input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}
.scope-mode__icon {
    color: var(--color-text-tertiary);
    font-size: var(--icon-size-md);
    margin-top: var(--space-0-5);
}
.scope-mode__opt--active .scope-mode__icon {
    color: var(--color-primary-text);
}
.scope-mode__body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 0;
}
.scope-mode__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.scope-mode__hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    line-height: 1.4;
}
</style>
