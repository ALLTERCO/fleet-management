<template>
    <div
        class="ctp"
        role="radiogroup"
        aria-label="Channel type"
    >
        <button
            v-for="entry in entries"
            :key="entry.value"
            type="button"
            :disabled="locked"
            v-bind="ariaAttrs(entry.value)"
            class="ctp__option"
            :class="{
                'ctp__option--active': entry.value === selected,
                'ctp__option--locked': locked
            }"
            :style="{'--ctp-color': `var(${entry.colorToken})`}"
            @click="pick(entry.value)"
        >
            <i :class="['ctp__icon', entry.icon]" aria-hidden="true" />
            <span class="ctp__label">{{ entry.label }}</span>
        </button>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import {
    type ChannelType,
    describeChannelType,
    listConfigurableChannelTypes
} from '@/helpers/channelTypes';

// A saved channel keeps its provider for life — channel.update carries no
// provider field. Locked mode shows the type without offering a change.
const {locked = false} = defineProps<{locked?: boolean}>();

const selected = defineModel<ChannelType>({required: true});

const entries = computed(() =>
    listConfigurableChannelTypes().map((value) => describeChannelType(value))
);

function pick(value: ChannelType): void {
    if (locked) return;
    selected.value = value;
}

function ariaAttrs(value: ChannelType): {
    role: string;
    'aria-checked': 'true' | 'false';
    'aria-disabled': 'true' | 'false';
} {
    return {
        role: 'radio',
        'aria-checked': value === selected.value ? 'true' : 'false',
        'aria-disabled': locked ? 'true' : 'false'
    };
}
</script>

<style scoped>
.ctp {
    display: grid;
    /* Six configurable types — three per row beats a five-wide row with one orphan. */
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-2);
    padding: var(--space-1);
    background-color: var(--color-surface-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-lg);
}

.ctp__option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1-5);
    padding: var(--space-3) var(--space-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition:
        color var(--duration-fast) var(--ease-out-expo),
        background-color var(--duration-fast) var(--ease-out-expo),
        border-color var(--duration-fast) var(--ease-out-expo);
}

.ctp__option:hover {
    color: var(--color-text-primary);
    background-color: var(--color-surface-3);
}

.ctp__option--locked {
    cursor: default;
}

.ctp__option--locked:not(.ctp__option--active) {
    opacity: var(--opacity-disabled);
}

.ctp__option--locked:hover {
    color: var(--color-text-secondary);
    background-color: transparent;
}

.ctp__option--locked.ctp__option--active:hover {
    color: var(--ctp-color);
    background-color: color-mix(in srgb, var(--ctp-color) 12%, transparent);
}

.ctp__option--active {
    color: var(--ctp-color);
    background-color: color-mix(in srgb, var(--ctp-color) 12%, transparent);
    border-color: color-mix(in srgb, var(--ctp-color) 40%, transparent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ctp-color) 30%, transparent);
}

.ctp__icon {
    font-size: var(--type-subheading);
    line-height: 1;
}

.ctp__label {
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    color: var(--color-text-primary);
}

.ctp__option--active .ctp__label {
    color: var(--ctp-color);
    font-weight: var(--font-semibold);
}

@media (max-width: 640px) {
    .ctp {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .ctp__label {
        font-size: var(--type-caption);
    }
}
</style>
