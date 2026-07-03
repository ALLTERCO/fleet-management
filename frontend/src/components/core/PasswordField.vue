<template>
    <!-- The <form> wrapper silences the "password not in a form" DOM
         warning for callers that don't provide their own form. When the
         parent already has a form (e.g. inside a modal), pass
         :standalone="false" to skip the wrapper — nested forms are
         invalid HTML and the inner form swallows submit events. -->
    <component
        :is="standalone ? 'form' : 'div'"
        class="pf"
        v-bind="standalone ? {onSubmit: preventSubmit} : {}"
    >
        <label v-if="label" :for="inputId" class="pf__label">{{ label }}</label>
        <div class="pf__row">
            <input
                :id="inputId"
                v-model="model"
                :type="revealed ? 'text' : 'password'"
                class="pf__input core-input"
                :placeholder="placeholder"
                :autocomplete="autocomplete ?? 'current-password'"
                :disabled="disabled"
                :required="required"
                @blur="$emit('blur')"
                @focus="$emit('focus')"
            />
            <button
                type="button"
                class="pf__reveal"
                :aria-label="revealed ? 'Hide value' : 'Reveal value'"
                @click="revealed = !revealed"
            >
                <i :class="revealed ? 'fas fa-eye-slash' : 'fas fa-eye'" />
            </button>
        </div>
        <p v-if="error" class="pf__error">{{ error }}</p>
    </component>
</template>

<script setup lang="ts">
import {ref, useId} from 'vue';

const model = defineModel<string>({required: true});

withDefaults(
    defineProps<{
        label?: string;
        placeholder?: string;
        autocomplete?: string;
        error?: string;
        disabled?: boolean;
        required?: boolean;
        /** True (default) wraps in <form> so the password input has a form
         *  ancestor. Pass false when the parent already owns a form to
         *  avoid nested <form> elements (invalid HTML + breaks submit). */
        standalone?: boolean;
    }>(),
    {standalone: true}
);

defineEmits<{blur: []; focus: []}>();

const inputId = `pf_${useId()}`;
const revealed = ref(false);

function preventSubmit(event: Event) {
    event.preventDefault();
}
</script>

<style scoped>
.pf {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 100%;
}
.pf__label {
    font-size: var(--type-body);
    font-weight: var(--font-semibold);
    color: var(--color-text-primary);
}
.pf__row {
    position: relative;
    display: flex;
    align-items: center;
}
.pf__input {
    flex: 1;
    padding-right: 2.5rem;
}
.pf__reveal {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 2.5rem;
    height: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--color-text-tertiary);
    cursor: pointer;
}
.pf__reveal:hover {
    color: var(--color-text-primary);
}
.pf__error {
    font-size: var(--type-body);
    color: var(--color-danger-text);
}
</style>
