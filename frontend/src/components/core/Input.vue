<template>
    <label v-if="label" :for="'generic_input_' + id" class="input-label block text-sm font-semibold pt-2 pb-2">
        {{ props.label }}
    </label>
    <div class="relative w-full">

        <input :id="'generic_input_' + id" v-model="model" :type="computedType"
            class="core-input border text-sm rounded-lg block w-full p-2"
            :class="[props.disabled && 'core-input--disabled', props.customClass, props.type === 'password' ? 'pr-10' : '']"
            :placeholder="props.placeholder" :max="props.max" :min="props.min" :disabled="props.disabled" :required="props.required"
            @focus="handleFocus" @blur="handleBlur" />

        <button v-if="model && props.type !== 'password' && props.clear" type="button"
            aria-label="Clear input"
            class="input-clear absolute right-0 top-1/2 transform -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center"
            @click="clearInput">
            ✕
        </button>
        <button v-if="props.type === 'password'" type="button"
            :aria-label="isPasswordVisible ? 'Hide password' : 'Show password'"
            class="absolute right-0 top-1/2 transform -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center cursor-pointer select-none text-white bg-transparent border-none"
            @click="toggleVisibility">
            <svg v-if="isPasswordVisible" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                stroke="currentColor" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.477 0-8.268-2.943-9.542-7a10.122 10.122 0 012.07-3.174M6.12 6.12A10.056 10.056 0 0112 5c4.477 0 8.268 2.943 9.542 7a10.122 10.122 0 01-1.017 1.766M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3l18 18" />
            </svg>
        </button>

        <!-- Display error message if present -->
        <div v-if="props.error" class="input-error text-sm mt-1">
            {{ props.error }}
        </div>
    </div>
</template>

<script setup lang="ts">
import {computed, ref, useId} from 'vue';

const id = useId();

const props = withDefaults(
    defineProps<{
        placeholder?: string;
        label?: string;
        type?: 'text' | 'password' | 'number' | 'datetime-local' | 'email';
        min?: number;
        max?: number;
        disabled?: boolean;
        customClass?: string;
        error?: string;
        clear?: boolean;
        required?: boolean;
    }>(),
    {
        type: 'text',
        placeholder: undefined,
        label: undefined,
        min: NaN,
        max: NaN,
        disabled: false,
        customClass: '',
        error: '',
        clear: false,
        required: false
    }
);

const emit = defineEmits<{
    focus: [];
    blur: [];
}>();

const handleFocus = () => {
    emit('focus');
};

const handleBlur = () => {
    emit('blur');
};

const model = defineModel<string | number | Function>({required: true});

const clearInput = () => {
    model.value = '';
};
const isPasswordVisible = ref(false);
const toggleVisibility = () => {
    isPasswordVisible.value = !isPasswordVisible.value;
};

const computedType = computed(() => {
    if (props.type === 'password') {
        return isPasswordVisible.value ? 'text' : 'password';
    }
    return props.type;
});
</script>

<style scoped>
.capitalized {
    text-transform: capitalize;
}
.input-label {
    color: var(--color-text-primary);
}
.core-input {
    background-color: var(--input-bg, var(--color-surface-1));
    border-color: var(--input-border, var(--color-border-strong));
    color: var(--color-text-primary);
}
.core-input::placeholder {
    color: var(--input-placeholder, var(--color-text-disabled));
}
.core-input--disabled {
    color: var(--color-text-disabled);
}
.input-clear {
    color: var(--color-text-tertiary);
}
.input-clear:hover {
    color: var(--color-text-secondary);
}
.input-error {
    color: var(--color-danger-text);
}
</style>