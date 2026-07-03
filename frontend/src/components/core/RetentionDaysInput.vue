<template>
    <div class="rdi">
        <Input
            v-model="cleanModel"
            type="number"
            :placeholder="placeholder"
            :min="1"
        />
        <p v-if="error" class="rdi__error">{{ error }}</p>
        <p v-else-if="hint" class="rdi__hint">{{ hint }}</p>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';
import Input from './Input.vue';

const model = defineModel<string>({required: true});

defineProps<{
    placeholder?: string;
    error?: string;
    hint?: string;
}>();

// Strip any non-digit characters the user types or pastes.
const cleanModel = computed<string>({
    get: () => model.value,
    set: (v: string) => {
        model.value = String(v).replace(/[^0-9]/g, '');
    }
});
</script>

<style scoped>
.rdi {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
}
.rdi__hint {
    font-size: var(--type-body);
    color: var(--color-text-tertiary);
}
.rdi__error {
    font-size: var(--type-body);
    color: var(--color-status-red);
}
</style>
