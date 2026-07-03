import {computed, type Ref, ref} from 'vue';
import {NAME_MAX_LENGTH} from '@/helpers/validation-limits';

// Required-name validator for edit modals.
// Returns the pure answer (errorText) and a do-side-effects sync().
export interface UseRequiredNameFieldOptions {
    /** Max length. Defaults to NAME_MAX_LENGTH from helpers/validation-limits. */
    maxLength?: number;
    /** Label for the "required" message. Defaults to "Name". */
    label?: string;
}

export function useRequiredNameField(
    value: Ref<string>,
    options: UseRequiredNameFieldOptions = {}
) {
    const maxLength = options.maxLength ?? NAME_MAX_LENGTH;
    const label = options.label ?? 'Name';
    const error = ref('');

    const errorText = computed(() => {
        const trimmed = value.value.trim();
        if (!trimmed) return `${label} is required`;
        if (trimmed.length > maxLength) return `Max ${maxLength} characters`;
        return '';
    });

    const isValid = computed(() => errorText.value === '');

    function sync(): void {
        error.value = errorText.value;
    }

    function reset(): void {
        error.value = '';
    }

    return {error, isValid, sync, reset};
}
