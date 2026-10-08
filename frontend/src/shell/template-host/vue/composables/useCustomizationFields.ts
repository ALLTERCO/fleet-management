// Named reads off the one customization store React also reads. The host builds
// it from Fleet's own customization ref, so only the source moves.

import {type ComputedRef, computed, type Ref} from 'vue';
import type {ProjectOverrides, ThemeTokens} from '@/shell/customizationSchema';
import {
    type ResolvedPresentationCustomization,
    resolvePresentationCustomization
} from '../../core/customization-presentation';
import {useExternalStore} from '../external-store';
import {useFleetRuntime} from '../provider';

/** The store is open so the SDK never tracks a schema version. Fleet only ever
 * puts a ProjectOverrides in it, so templates keep their field types. */
export function useCustomization(): Readonly<Ref<ProjectOverrides>> {
    const store = useFleetRuntime().customization;
    return useExternalStore(store) as Readonly<Ref<ProjectOverrides>>;
}

export function useCustomizationField<K extends keyof ProjectOverrides>(
    key: K
): ComputedRef<ProjectOverrides[K] | undefined> {
    const customization = useCustomization();
    return computed(() => customization.value[key]);
}

export function useNavLabels(): ComputedRef<Record<string, string>> {
    const labels = useCustomizationField('navLabels');
    return computed(() => labels.value ?? {});
}

export function useNavOrder(): ComputedRef<string[]> {
    const order = useCustomizationField('navOrder');
    return computed(() => order.value ?? []);
}

export function useThemeTokens(): ComputedRef<ThemeTokens> {
    const theme = useCustomizationField('theme');
    return computed(() => theme.value ?? {});
}

export function usePresentationCustomization(): ComputedRef<ResolvedPresentationCustomization> {
    const customization = useCustomization();
    return computed(() =>
        resolvePresentationCustomization(customization.value)
    );
}
