<template>
    <CardShell
        type="generic"
        :name="title"
        icon="fas fa-triangle-exclamation"
        :size="size"
        :is-on="false"
        :edit-mode="editMode"
        @delete="emit('delete')"
        @move="(d: number) => emit('move', d)"
        @cycle-size="emit('cycle-size')"
        @resize="(s: string) => emit('resize', s)"
    >
        <div class="mc">
            <i class="fas fa-triangle-exclamation mc__icon" />
            <span class="mc__title">{{ title }}</span>
            <span v-if="hint" class="mc__hint">{{ hint }}</span>
        </div>
    </CardShell>
</template>

<script setup lang="ts">
import CardShell from '@/components/cards/CardShell.vue';
import type {CardSize} from '@/types/dashboard-entry';

withDefaults(
    defineProps<{
        title: string;
        hint?: string;
        size: CardSize;
        editMode?: boolean;
    }>(),
    {
        hint: undefined,
        editMode: false
    }
);

const emit = defineEmits<{
    delete: [];
    move: [direction: number];
    'cycle-size': [];
    resize: [size: string];
}>();
</script>

<style scoped>
.mc {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: var(--space-2);
    padding: var(--space-3);
}
.mc__icon {
    font-size: var(--type-subheading);
    color: var(--color-warning-text);
}
.mc__title {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-secondary);
    text-align: center;
}
.mc__hint {
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    color: var(--color-text-quaternary);
}
</style>
