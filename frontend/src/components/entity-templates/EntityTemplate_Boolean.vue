<template>
    <div class="et-bool">
        <!-- Current value display -->
        <div class="et-bool__state" :class="currentValue ? 'et-bool__state--true' : 'et-bool__state--false'">
            <i :class="currentValue ? 'fas fa-toggle-on' : 'fas fa-toggle-off'" class="et-bool__state-icon" />
            <span>{{ displayLabel }}</span>
        </div>

        <!-- Toggle control -->
        <div v-if="canExecute && isToggle" class="et-bool__control">
            <button
                class="et-bool__toggle"
                :class="currentValue && 'et-bool__toggle--on'"
                @click="emit('set', !currentValue)"
            >
                <i class="fas fa-power-off" />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    view?: string;
    labelTrue?: string;
    labelFalse?: string;
}>();

const emit = defineEmits<{
    set: [value: boolean];
}>();

const currentValue = computed(() => !!props.status?.value);
const isToggle = computed(() => props.view === 'toggle');

const displayLabel = computed(() => {
    if (currentValue.value) return props.labelTrue || 'True';
    return props.labelFalse || 'False';
});
</script>

<style scoped>
.et-bool {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-bool__state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    font-weight: var(--font-semibold);
    font-size: var(--type-body);
}
.et-bool__state--true {
    background-color: var(--color-success-subtle);
    color: var(--color-success-text);
}
.et-bool__state--false {
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
}
.et-bool__state-icon {
    font-size: var(--type-subheading);
}
.et-bool__control {
    display: flex;
    justify-content: center;
}
.et-bool__toggle {
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--type-body);
    cursor: pointer;
    border: 1px solid var(--color-border-default);
    background-color: var(--color-surface-3);
    color: var(--color-text-tertiary);
    transition: background-color var(--duration-fast) var(--ease-default),
                color var(--duration-fast) var(--ease-default);
}
.et-bool__toggle:hover {
    color: var(--color-text-primary);
}
.et-bool__toggle--on {
    background-color: var(--color-success);
    border-color: var(--color-success);
    color: var(--color-text-primary);
}
</style>
