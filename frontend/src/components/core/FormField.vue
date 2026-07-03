<template>
    <div class="form-field">
        <label v-if="label" :for="fieldId" class="form-field__label block text-base mb-1">
            {{ label }}
            <span v-if="optional" class="form-field__optional">(optional)</span>
        </label>
        <slot />
        <p v-if="error" class="form-field__error text-base mt-1">{{ error }}</p>
        <p v-else-if="hint" class="form-field__hint text-base mt-1">{{ hint }}</p>
    </div>
</template>

<script setup lang="ts">
defineProps<{
    label?: string;
    error?: string;
    hint?: string;
    optional?: boolean;
    fieldId?: string;
}>();
</script>

<style scoped>
.form-field__label {
    color: var(--color-text-secondary);
}
.form-field__optional {
    color: var(--color-text-tertiary);
}
.form-field__error {
    color: var(--color-input-error);
}
.form-field__hint {
    color: var(--color-text-tertiary);
}
</style>
