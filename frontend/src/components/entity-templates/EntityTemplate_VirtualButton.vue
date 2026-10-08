<template>
    <div class="et-vbtn">
        <template v-if="canExecute">
            <button
                type="button"
                class="et-vbtn__trigger"
                :disabled="pressing !== null"
                @click="press('single_push')"
            >
                <i
                    v-if="pressing === 'single_push'"
                    class="fas fa-spinner fa-spin"
                />
                <i v-else class="fas fa-circle-dot" />
                <span>Press</span>
            </button>
            <div class="et-vbtn__kinds">
                <button
                    v-for="kind in SECONDARY_KINDS"
                    :key="kind.event"
                    type="button"
                    class="et-vbtn__kind"
                    :disabled="pressing !== null"
                    :title="kind.title"
                    @click="press(kind.event)"
                >
                    <i
                        v-if="pressing === kind.event"
                        class="fas fa-spinner fa-spin"
                    />
                    <span v-else>{{ kind.label }}</span>
                </button>
            </div>
        </template>
        <div v-else class="et-vbtn__readonly">
            <i class="fas fa-circle-dot" />
            <span>Button (read-only)</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import {onBeforeUnmount, ref} from 'vue';

// Scripts key off the exact press kind, so each firmware event is its own
// explicit control.
type PressEvent = 'single_push' | 'double_push' | 'triple_push' | 'long_push';

const SECONDARY_KINDS: Array<{
    event: PressEvent;
    label: string;
    title: string;
}> = [
    {event: 'double_push', label: 'Double', title: 'Double push'},
    {event: 'triple_push', label: 'Triple', title: 'Triple push'},
    {event: 'long_push', label: 'Long', title: 'Long push'}
];

defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
}>();

const emit = defineEmits<{
    press: [event: PressEvent];
}>();

const pressing = ref<PressEvent | null>(null);
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function press(event: PressEvent) {
    pressing.value = event;
    emit('press', event);
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => {
        pressing.value = null;
        releaseTimer = undefined;
    }, 1000);
}

onBeforeUnmount(() => {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
});
</script>

<style scoped>
.et-vbtn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
}
.et-vbtn__trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.et-vbtn__trigger:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}
.et-vbtn__trigger:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.et-vbtn__kinds {
    display: flex;
    gap: var(--space-2);
}
.et-vbtn__kind {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-16);
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border-medium);
    background-color: transparent;
    color: var(--color-text-secondary);
    font-size: var(--type-caption);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition:
        background-color var(--duration-fast) var(--ease-default),
        color var(--duration-fast) var(--ease-default);
}
.et-vbtn__kind:hover:not(:disabled) {
    background-color: var(--color-surface-2);
    color: var(--color-text-primary);
}
.et-vbtn__kind:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.et-vbtn__readonly {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background-color: var(--color-surface-2);
    color: var(--color-text-disabled);
    font-size: var(--type-body);
}
</style>
