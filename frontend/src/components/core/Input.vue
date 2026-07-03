<template>
    <label v-if="label" :for="'generic_input_' + id" class="input-label block text-base font-semibold pt-2 pb-2">
        {{ props.label }}
    </label>
    <div class="relative w-full">

        <input :id="'generic_input_' + id" v-model="model" :type="computedType"
            class="core-input border text-base rounded-lg block w-full p-2"
            :class="[props.disabled && 'core-input--disabled', props.customClass, props.type === 'password' ? 'pr-10' : '']"
            :placeholder="props.placeholder" :max="Number.isFinite(props.max) ? props.max : undefined" :min="Number.isFinite(props.min) ? props.min : undefined" :disabled="props.disabled" :required="props.required" :autocomplete="props.autocomplete ?? defaultAutocomplete"
            :inputmode="props.inputmode ?? defaultInputmode"
            :enterkeyhint="props.enterkeyhint"
            :autocapitalize="props.autocapitalize ?? defaultAutocapitalize"
            :autocorrect="props.autocorrect ?? defaultAutocorrect"
            :spellcheck="props.spellcheck ?? defaultSpellcheck"
            :maxlength="props.maxlength"
            @focus="handleFocus" @blur="handleBlur" />

        <button v-if="model && props.type !== 'password' && props.clear" type="button"
            aria-label="Clear input"
            class="input-clear absolute right-0 top-1/2 transform -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center"
            @click="clearInput">
            <i class="fas fa-xmark" aria-hidden="true" />
        </button>
        <button v-if="props.type === 'password'" type="button"
            :aria-label="isPasswordVisible ? 'Hide password' : 'Show password'"
            class="absolute right-0 top-1/2 transform -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center cursor-pointer select-none text-[var(--color-text-primary)] bg-transparent border-none"
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

type InputType =
    | 'text'
    | 'password'
    | 'number'
    | 'datetime-local'
    | 'email'
    | 'tel'
    | 'url'
    | 'search';

const props = withDefaults(
    defineProps<{
        placeholder?: string;
        label?: string;
        type?: InputType;
        min?: number;
        max?: number;
        disabled?: boolean;
        customClass?: string;
        error?: string;
        clear?: boolean;
        required?: boolean;
        autocomplete?: string;
        inputmode?:
            | 'none'
            | 'text'
            | 'tel'
            | 'url'
            | 'email'
            | 'numeric'
            | 'decimal'
            | 'search';
        enterkeyhint?:
            | 'enter'
            | 'done'
            | 'go'
            | 'next'
            | 'previous'
            | 'search'
            | 'send';
        autocapitalize?:
            | 'off'
            | 'none'
            | 'on'
            | 'sentences'
            | 'words'
            | 'characters';
        autocorrect?: 'on' | 'off';
        spellcheck?: boolean;
        maxlength?: number;
    }>(),
    {
        type: 'text',
        placeholder: undefined,
        label: undefined,
        min: Number.NaN,
        max: Number.NaN,
        disabled: false,
        customClass: '',
        error: '',
        clear: false,
        required: false,
        autocomplete: undefined,
        inputmode: undefined,
        enterkeyhint: undefined,
        autocapitalize: undefined,
        autocorrect: undefined,
        spellcheck: undefined,
        maxlength: undefined
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

const model = defineModel<string | number>({required: true});

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

// Per-type defaults so callers don't have to remember every mobile keyboard hint.
// All overridable via explicit props.
const defaultInputmode = computed(() => {
    switch (props.type) {
        case 'email':
            return 'email';
        case 'tel':
            return 'tel';
        case 'url':
            return 'url';
        case 'search':
            return 'search';
        case 'number':
            return Number.isFinite(props.min) && Number(props.min) < 0
                ? 'numeric'
                : 'decimal';
        default:
            return undefined;
    }
});
const defaultAutocomplete = computed(() => {
    switch (props.type) {
        case 'email':
            return 'email';
        case 'tel':
            return 'tel';
        case 'url':
            return 'url';
        case 'password':
            return 'current-password';
        default:
            return 'off';
    }
});
const defaultAutocapitalize = computed(() => {
    switch (props.type) {
        case 'email':
        case 'tel':
        case 'url':
        case 'password':
            return 'off';
        default:
            return undefined;
    }
});
const defaultAutocorrect = computed(() => {
    switch (props.type) {
        case 'email':
        case 'tel':
        case 'url':
        case 'password':
        case 'search':
            return 'off';
        default:
            return undefined;
    }
});
const defaultSpellcheck = computed(() => {
    switch (props.type) {
        case 'email':
        case 'tel':
        case 'url':
        case 'password':
            return false;
        default:
            return undefined;
    }
});
</script>

<style scoped>
.capitalized {
    text-transform: capitalize;
}
.input-label {
    color: var(--color-text-primary);
}
/* .core-input rules live in styles/components.css so every component
   using the class (Input, PasswordField, SchemaForm selects, pickers)
   gets identical border / focus / number-input treatment. */
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