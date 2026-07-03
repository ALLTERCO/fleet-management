<template>
    <div class="sdf">
        <header class="sdf__hdr">
            <i :class="`fas ${dim.icon} sdf__hdr-icon`" aria-hidden="true" />
            <span class="sdf__hdr-label">{{ dim.label }}</span>
            <Pill v-if="model.length" variant="primary">
                {{ model.length }}
            </Pill>
        </header>

        <div v-if="model.length" class="sdf__chips">
            <Pill v-for="v in model" :key="String(v)" variant="primary">
                {{ labelFor(v) }}
                <button
                    type="button"
                    class="sdf__chip-remove"
                    :title="`Remove ${labelFor(v)}`"
                    @click="remove(v)"
                >
                    <i class="fas fa-times" aria-hidden="true" />
                </button>
            </Pill>
        </div>

        <p v-if="options.length === 0" class="sdf__empty">
            No {{ dim.label.toLowerCase() }} exist yet — create one first, or
            scope by something else.
        </p>
        <Dropdown
            v-else-if="remaining > 0"
            :groups="addGroups"
            :placeholder="`Add ${dim.label.toLowerCase()}…`"
            searchable
            @selected="onAdd"
        />
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Dropdown from '@/components/core/Dropdown.vue';
import Pill from '@/components/core/Pill.vue';
import type {ScopeDimension, ScopeOption} from '@/helpers/scopeDimensions';

const props = defineProps<{
    dim: ScopeDimension;
    options: ScopeOption[];
}>();

const model = defineModel<Array<string | number>>({required: true});

const labels = computed(
    () => new Map(props.options.map((o) => [o.value, o.label]))
);

function labelFor(value: string | number): string {
    return labels.value.get(value) ?? String(value);
}

// Offer only what isn't picked yet.
const addGroups = computed(() => [
    {
        label: '',
        items: props.options.filter((o) => !model.value.includes(o.value))
    }
]);

const remaining = computed(() => addGroups.value[0].items.length);

function onAdd(value: string | number): void {
    if (model.value.includes(value)) return;
    model.value = [...model.value, value];
}

function remove(value: string | number): void {
    model.value = model.value.filter((v) => v !== value);
}
</script>

<style scoped>
.sdf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.sdf__hdr {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--color-text-secondary);
}
.sdf__hdr-icon {
    color: var(--color-text-tertiary);
}
.sdf__hdr-label {
    font-weight: var(--font-semibold);
}
.sdf__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}
.sdf__empty {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    border: 1px dashed var(--color-border-medium);
    border-radius: var(--radius-md);
    color: var(--color-text-tertiary);
    font-size: var(--type-caption);
}
.sdf__chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--color-primary);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: color var(--duration-fast);
}
.sdf__chip-remove:hover {
    color: var(--color-danger-text);
}
</style>
