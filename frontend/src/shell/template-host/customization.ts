// The Ref wrap now lives directly in @/shell/customization (templates'
// contract is honoured at the inject site). We just re-export it so @host
// stays the single import for templates.
//
// IMPORTANT for downstream hooks: useCustomization() returns
// `Readonly<Ref<ProjectOverrides>>`. To read a field you MUST go through
// `.value` (e.g. `customization.value.hiddenSections`). Reading
// `customization.hiddenSections` silently yields `undefined` at runtime
// because TS doesn't strict-check these files in the current build, and
// the result is every customisation override being silently dropped on
// the floor. Prefer `useCustomizationField(...)` below — its signature
// makes the unwrap impossible to forget.

import {type ComputedRef, computed} from 'vue';
import {useCustomization} from '@/shell/customization';
import type {ProjectOverrides} from '@/shell/customizationSchema';

export {useCustomization};

/**
 * Typed accessor for a single customisation field.
 *
 * Returns a `ComputedRef<ProjectOverrides[K] | undefined>` that always
 * unwraps the underlying `Ref` correctly. Use this instead of writing
 * `computed(() => useCustomization().value.X)` by hand — it's a one-liner
 * and removes the "forgot .value" foot-gun.
 *
 *   const hidden = useCustomizationField('hiddenSections'); // ComputedRef<string[] | undefined>
 */
export function useCustomizationField<K extends keyof ProjectOverrides>(
    key: K
): ComputedRef<ProjectOverrides[K] | undefined> {
    const ref = useCustomization();
    return computed(() => ref.value[key]);
}
