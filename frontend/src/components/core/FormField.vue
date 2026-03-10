<template>
    <div class="form-field">
        <label v-if="label" :for="fieldId" class="form-field__label block text-sm mb-1">
            {{ label }}
            <span v-if="optional" class="form-field__optional">(optional)</span>
        </label>
        <slot />
        <p v-if="error" class="form-field__error text-xs mt-1">{{ error }}</p>
        <p v-else-if="hint" class="form-field__hint text-xs mt-1">{{ hint }}</p>
    </div>
</template>

<script setup lang="ts">
import {computed} from 'vue';

const props = defineProps<{
    label?: string;
    error?: string;
    hint?: string;
    optional?: boolean;
    fieldId?: string;
}>();

const fieldId = computed(() => props.fieldId);
</script>

<style scoped>
.form-field__label {
    color: var(--color-text-tertiary);
}
.form-field__optional {
    color: var(--color-text-disabled);
}
.form-field__error {
    color: var(--color-input-error);
}
.form-field__hint {
    color: var(--color-text-disabled);
}
</style>
