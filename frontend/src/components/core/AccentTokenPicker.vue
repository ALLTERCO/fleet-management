<template>
    <div class="atp">
        <button
            v-for="t in tokens"
            :key="t.key ?? '__none__'"
            type="button"
            class="atp__swatch"
            :class="t.key === modelValue && 'atp__swatch--active'"
            :style="t.key ? {background: `rgb(var(--accent-${t.key}))`} : undefined"
            :title="t.label"
            :aria-label="t.label"
            :aria-pressed="t.key === modelValue"
            @click="emit('update:modelValue', t.key)"
        >
            <i v-if="!t.key" class="fas fa-ban" />
        </button>
    </div>
</template>

<script setup lang="ts">
// Used by template v-for (biome can't see template refs).
import {ACCENT_TOKENS as tokens} from '@/config/accentTokens';

defineProps<{
    modelValue: string | null;
}>();

const emit = defineEmits<{
    'update:modelValue': [value: string | null];
}>();
</script>

<style scoped>
.atp {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: var(--space-2);
}

.atp__swatch {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    border: 2px solid var(--color-border-medium);
    cursor: pointer;
    transition: transform 0.12s ease, border-color 0.12s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-tertiary);
}

.atp__swatch:hover {
    transform: scale(1.08);
    border-color: var(--color-border-strong);
}

.atp__swatch--active {
    border-color: var(--color-text-primary);
    box-shadow: 0 0 0 2px rgba(var(--color-primary-rgb), 0.35);
}
</style>
