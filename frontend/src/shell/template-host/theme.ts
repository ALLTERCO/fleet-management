import {type ComputedRef, computed} from 'vue';
import type {ThemeTokens} from '@/shell/customizationSchema';
import {useCustomizationField} from './customization';

export function useThemeTokens(): ComputedRef<ThemeTokens> {
    const theme = useCustomizationField('theme');
    return computed(() => theme.value ?? {});
}
