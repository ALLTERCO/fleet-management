<template>
    <div class="form-field">
        <label v-if="label" :for="fieldId ?? ownId" class="form-field__label block text-base mb-1">
            {{ label }}
            <span v-if="optional" class="form-field__optional">(optional)</span>
        </label>
        <slot />
        <p v-if="error" :id="errorId" class="form-field__error text-base mt-1" role="alert">
            {{ error }}
        </p>
        <p v-else-if="hint" :id="hintId" class="form-field__hint text-base mt-1">
            {{ hint }}
        </p>
    </div>
</template>

<script setup lang="ts">
import {useId} from 'vue';
import {provideFieldId} from '@/composables/useFieldId';

const props = defineProps<{
    label?: string;
    error?: string;
    hint?: string;
    optional?: boolean;
    /** Override the generated id when a caller already owns one. */
    fieldId?: string;
}>();

const ownId = `form-field-${useId()}`;
const errorId = `${ownId}-error`;
const hintId = `${ownId}-hint`;

// The field owns the id; the control it wraps asks for it. Without this the
// label's `for` pointed at nothing, so clicking it focused nothing and the
// control was announced unlabelled.
provideFieldId({
    id: props.fieldId ?? ownId,
    describedBy: () => (props.error ? errorId : props.hint ? hintId : undefined),
    invalid: () => !!props.error
});
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
