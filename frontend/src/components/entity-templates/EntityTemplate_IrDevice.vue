<template>
    <div class="et-irdevice">
        <div class="et-irdevice__hero">
            <span class="et-irdevice__name">{{ displayName }}</span>
            <span class="et-irdevice__kind">IR device</span>
        </div>
        <button
            v-if="canExecute"
            type="button"
            class="et-irdevice__learn"
            :disabled="learning"
            @click="learn"
        >
            <i v-if="learning" class="fas fa-spinner fa-spin" />
            <i v-else class="fas fa-wand-magic-sparkles" />
            <span>{{ learning ? 'Point the remote at the device…' : 'Learn code' }}</span>
        </button>
        <p class="et-irdevice__note">
            <i class="fas fa-circle-info" />
            Code playback controls arrive once the firmware documents code
            addressing.
        </p>
    </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, ref} from 'vue';

// First pass: the documented IRDevice surface is config {id, name} plus
// LearnCode by id. Emit stays out until the firmware pins code addressing,
// so the template renders the one safe control and ignores unknown fields.
const props = defineProps<{
    status: Record<string, any> | undefined;
    settings: Record<string, any> | undefined;
    canExecute: boolean;
    shellyID?: string;
    entityName?: string;
}>();

const emit = defineEmits<{
    learn: [];
}>();

// settings is the live component config (renames land there first); the
// entity name is the compose-time snapshot fallback.
const displayName = computed(() => {
    const fromSettings = props.settings?.name;
    if (typeof fromSettings === 'string' && fromSettings) return fromSettings;
    return props.entityName || 'IR device';
});

// Learning happens on the device; without a documented completion event the
// button re-arms after a fixed window instead of pretending to track it.
const LEARN_WINDOW_MS = 10_000;
const learning = ref(false);
let learnTimer: ReturnType<typeof setTimeout> | undefined;

function learn() {
    learning.value = true;
    emit('learn');
    if (learnTimer !== undefined) clearTimeout(learnTimer);
    learnTimer = setTimeout(() => {
        learning.value = false;
        learnTimer = undefined;
    }, LEARN_WINDOW_MS);
}

onBeforeUnmount(() => {
    if (learnTimer !== undefined) clearTimeout(learnTimer);
});
</script>

<style scoped>
.et-irdevice {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}
.et-irdevice__hero {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
}
.et-irdevice__name {
    font-size: var(--type-subheading);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.et-irdevice__kind {
    font-size: var(--type-caption);
    color: var(--color-text-tertiary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-caps);
}
.et-irdevice__learn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-primary);
    background-color: color-mix(in srgb, var(--color-primary) 15%, transparent);
    color: var(--color-primary);
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    cursor: pointer;
    transition: background-color var(--duration-fast) var(--ease-default);
}
.et-irdevice__learn:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}
.et-irdevice__learn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
}
.et-irdevice__note {
    display: flex;
    align-items: center;
    gap: var(--space-1-5);
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-2);
}
</style>
