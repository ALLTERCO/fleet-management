import {type ComputedRef, computed} from 'vue';
import type {ThemeTokens} from '@/shell/customizationSchema';
import {
    type ResolvedPresentationCustomization,
    resolvePresentationCustomization
} from './core/customization-presentation';
import {useCustomization, useCustomizationField} from './customization';

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
