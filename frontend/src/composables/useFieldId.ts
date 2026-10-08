// One id per form field, owned by FormField and consumed by whatever control
// it wraps.
//
// The label needs `for`, the control needs a matching `id`, and the hint or
// error needs to be referenced by `aria-describedby`. Those three have to agree
// or the label is decorative: clicking it focuses nothing and assistive tech
// announces the control unlabelled.
//
// FormField is the single owner. A control asks for the id rather than
// inventing one, and falls back to its own only when it is used standalone.

import {
    type ComputedRef,
    computed,
    type InjectionKey,
    inject,
    provide,
    useId
} from 'vue';

export interface FieldBinding {
    /** The id the label's `for` points at. */
    id: string;
    /** Id of the hint or error paragraph, for `aria-describedby`. */
    describedBy: () => string | undefined;
    /** Whether the field is currently rejected, for `aria-invalid`. */
    invalid: () => boolean;
}

const FIELD_BINDING: InjectionKey<FieldBinding> = Symbol('fm.fieldBinding');

/** Called by FormField. Owns the id and publishes it to its control. */
export function provideFieldId(binding: FieldBinding): void {
    provide(FIELD_BINDING, binding);
}

/**
 * Called by a form control. Returns the wrapping field's binding, or a
 * standalone one when the control is used outside a FormField.
 */
export function useFieldId(): {
    id: ComputedRef<string>;
    describedBy: ComputedRef<string | undefined>;
    invalid: ComputedRef<boolean>;
} {
    const own = `field-${useId()}`;
    const binding = inject(FIELD_BINDING, null);
    return {
        id: computed(() => binding?.id ?? own),
        describedBy: computed(() => binding?.describedBy()),
        invalid: computed(() => binding?.invalid() ?? false)
    };
}
